const WebSocket = require('ws');
const net = require('net');
const tls = require('tls');
const http = require('http');

// A Render automatikusan beállítja a PORT környezeti változót
const PORT = process.env.PORT || 3000;

// Hozunk létre egy egyszerű HTTP szervert a WSS protokoll befogadásához
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Websocket Proxy is running.');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws, req) {
    let targetSocket = null;
    let isConnected = false;
    let bufferedData = null;

    console.log('\n--- Új Websocket kapcsolat létrejött.');

    ws.on('message', function incoming(message) {
        try {
            const jsonMessage = JSON.parse(message);

            if (jsonMessage.type === 'tcp' && !isConnected) {
                const host = jsonMessage.host;
                const port = jsonMessage.port;

                if (!host || !port) {
                    console.error('WS: Hiányzó host vagy port a TCP parancsban.');
                    return;
                }

                console.log(`WS: Parancs érkezett: ${JSON.stringify(jsonMessage)}`);

                if (port === 443) {
                    // --- TLS / HTTPS KAPCSOLAT KEZELÉSE ---
                    console.log(`Nyitás TLS (HTTPS) kapcsolaton: ${host}:${port}`);
                    
                    targetSocket = tls.connect({
                        port: port,
                        host: host,
                        // JAVÍTÁS 1: Eltávolítja a 'self-signed certificate' hibát
                        rejectUnauthorized: false, 
                        // JAVÍTÁS 2: Ez fixálja a 'handshake failure' hibát
                        minVersion: 'TLSv1.2'      
                    }, () => {
                        // Sikeres kapcsolat esetén
                        isConnected = true;
                        if (bufferedData) {
                            targetSocket.write(bufferedData);
                            bufferedData = null;
                        }
                        ws.send(JSON.stringify({ type: 'dns_response', status: 'ok' }));
                    });

                } else {
                    // --- NEM TITKOSÍTOTT TCP / HTTP KAPCSOLAT ---
                    console.log(`Nyitás NET (HTTP) kapcsolaton: ${host}:${port}`);
                    
                    targetSocket = net.connect(port, host, () => {
                        isConnected = true;
                        if (bufferedData) {
                            targetSocket.write(bufferedData);
                            bufferedData = null;
                        }
                        ws.send(JSON.stringify({ type: 'dns_response', status: 'ok' }));
                    });
                }
                
                // --- CÉL SOCKET ESEMÉNYKEZELÉSE ---
                
                targetSocket.on('data', (data) => {
                    console.log(`--- Adat érkezett a cél szervertől, méret: ${data.length}`);
                    ws.send(data);
                });

                targetSocket.on('error', (err) => {
                    console.error(`❌ TCP/TLS Socket hiba: ${err.message}`);
                    ws.send(JSON.stringify({ type: 'error', message: `TCP/TLS Hiba: ${err.message}` }));
                    targetSocket.destroy();
                });

                targetSocket.on('close', () => {
                    console.log('TCP/TLS kapcsolat lezárva a célhoszt felé.');
                    ws.close();
                });

            } else {
                // Adat továbbítása
                if (targetSocket && isConnected) {
                    targetSocket.write(message);
                } else if (!isConnected) {
                    // Csatlakozás előtt érkező adat pufferelése
                    bufferedData = message;
                }
            }
            
        } catch (e) {
            // Nem JSON üzenet (adat) kezelése a WS-en
            if (targetSocket && isConnected) {
                targetSocket.write(message);
            } else if (!isConnected) {
                bufferedData = message;
            }
        }
    });

    ws.on('close', function close() {
        console.log('Websocket kapcsolat lezárult.');
        if (targetSocket) {
            targetSocket.destroy();
        }
    });

    ws.on('error', function error(err) {
        console.error(`Websocket hiba: ${err.message}`);
        if (targetSocket) {
            targetSocket.destroy();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
