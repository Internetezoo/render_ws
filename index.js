const WebSocket = require('ws');
const net = require('net');
const tls = require('tls');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Egy egyszerű HTTP szerver, amely fogadja a Websocket kapcsolatot
const server = http.createServer((req, res) => {
    // Általános HTTP válasz, ha valaki sima HTTP-vel próbálkozik
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Websocket Proxy is running.');
});

// Websocket szerver inicializálása
const wss = new WebSocket.Server({ server });

// Websocket kapcsolatonkénti adatpufferek tárolására
const connectionData = new Map();

wss.on('connection', function connection(ws, req) {
    let targetSocket = null;
    let isConnected = false;
    // Puffer a Websocket kapcsolat létrehozása előtt érkező adatoknak
    let bufferedData = null;

    console.log('\n--- Új Websocket kapcsolat létrejött.');

    ws.on('message', function incoming(message) {
        try {
            // Megpróbáljuk JSON-ként értelmezni (ez a parancs)
            const jsonMessage = JSON.parse(message);

            if (jsonMessage.type === 'tcp' && !isConnected) {
                // TCP Csatlakozási kérés (host és port)
                const host = jsonMessage.host;
                const port = jsonMessage.port;

                if (!host || !port) {
                    console.error('WS: Hiányzó host vagy port a TCP parancsban.');
                    return;
                }

                console.log(`WS: Parancs érkezett: ${JSON.stringify(jsonMessage)}`);

                if (port === 443) {
                    // --- TLS / HTTPS KAPCSOLAT ---
                    console.log(`Nyitás TLS (HTTPS) kapcsolaton: ${host}:${port}`);
                    
                    // JAVÍTÁS: A self-signed certificate és handshake failure hibák
                    // elkerülésére hozzáadjuk a rejectUnauthorized: false opciót.
                    targetSocket = tls.connect({
                        port: port,
                        host: host,
                        rejectUnauthorized: false // <--- JAVÍTVA
                    }, () => {
                        // Sikeres kapcsolat esetén
                        isConnected = true;
                        if (bufferedData) {
                            targetSocket.write(bufferedData);
                            bufferedData = null;
                        }
                        // Megerősítés visszaküldése a Python kliensnek
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
                    // Adat küldése a Websocket kliensnek (Python Bridge)
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
                    // Tájékoztatjuk a Websocket klienst a kapcsolat lezárásáról
                    ws.close();
                });

            } else {
                // Nyert bináris adatok küldése a cél socket-nek
                if (targetSocket && isConnected) {
                    targetSocket.write(message);
                } else if (!isConnected) {
                    // Pufferelés, ha a kapcsolat még nem jött létre
                    bufferedData = message;
                }
            }
            
        } catch (e) {
            // Ha nem JSON üzenet (ezek a nyers HTTP/HTTPS adatok)
            if (targetSocket && isConnected) {
                targetSocket.write(message);
            } else if (!isConnected) {
                // Pufferelés, ha a kapcsolat még nem jött létre
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
