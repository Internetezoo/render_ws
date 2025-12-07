const WebSocket = require('ws');
const net = require('net');
const tls = require('tls');
const constants = require('crypto').constants; // A TLS opciókhoz szükséges
const url = require('url');

const port = process.env.PORT || 8080; 

const wss = new WebSocket.Server({ port });

console.log(`WebSocket server listening on port ${port}`);

wss.on('connection', function connection(ws, req) {
    console.log(`--- Új Websocket kapcsolat létrejött. IP: ${req.socket.remoteAddress}`);
    
    let targetSocket = null;
    let isTls = false;
    
    ws.on('message', function incoming(message) {
        if (targetSocket) {
            // ... adat továbbítás ...
            if (typeof message === 'string') {
                targetSocket.write(message);
            } else {
                targetSocket.write(message);
            }
            return;
        }

        try {
            const command = JSON.parse(message.toString());
            
            if (command.type === 'tcp') {
                const targetHost = command.host;
                const targetPort = command.port;
                
                isTls = targetPort === 443;
                
                console.log(`WS: Parancs érkezett: ${JSON.stringify(command)}`);
                console.log(`Nyitás ${isTls ? 'TLS (HTTPS)' : 'TCP (HTTP)'} kapcsolaton: ${targetHost}:${targetPort}`);
                
                let connectOptions = {
                    host: targetHost,
                    port: targetPort,
                };
                
                // ====================================================================
                // 💥 A KRITIKUS JAVÍTÁSOK (csak 443-as portnál)
                if (isTls) {
                    // 1. SNI Fix: Kényszerítjük a Server Name Indication használatát (example.com hiba miatt)
                    connectOptions.servername = targetHost; 
                    
                    // 2. TLS Szigorítás (SSL alert 40 hiba miatt)
                    connectOptions.secureOptions = constants.SSL_OP_NO_SSLv2 | 
                                                  constants.SSL_OP_NO_SSLv3 | 
                                                  constants.SSL_OP_NO_TLSv1 | 
                                                  constants.SSL_OP_NO_TLSv1_1;
                    connectOptions.minVersion = 'TLSv1.2';
                    connectOptions.ciphers = 'TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256';

                    // 3. Tanúsítvány Ellenőrzés Bypass (utolsó kísérlet a 40-es hiba megkerülésére)
                    // FIGYELEM: Ez biztonsági kockázatot jelent!
                    connectOptions.rejectUnauthorized = false;
                }
                // ====================================================================

                const connector = isTls ? tls.connect : net.connect;
                targetSocket = connector(connectOptions, () => {
                    console.log(`   ✅ Sikeresen csatlakozva a célhoszthoz.`);
                    ws.send(JSON.stringify({ type: 'dns_response' }));
                });

                // --- Adat továbbítás Websocket --> Célhoszt ---
                ws.on('message', (data) => {
                    if (targetSocket && !targetSocket.destroyed) {
                        targetSocket.write(data);
                    }
                });

                // --- Adat továbbítás Célhoszt --> Websocket ---
                targetSocket.on('data', (data) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                    }
                });

                // --- Hibakezelés ---
                targetSocket.on('error', (err) => {
                    console.error(`❌ TCP/TLS Socket hiba: ${err.message}`);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'error', message: `TCP/TLS Hiba: ${err.message}` }));
                    }
                    ws.close();
                });

                targetSocket.on('close', () => {
                    console.log('TCP/TLS kapcsolat lezárva a célhoszt felé.');
                    ws.close();
                });

            } else {
                console.warn(`WS: Ismeretlen parancs típus: ${command.type}`);
            }

        } catch (e) {
            console.error(`WS: Hiba a parancs feldolgozásakor: ${e.message}`);
            ws.send(JSON.stringify({ type: 'error', message: `Parancsfeldolgozási hiba: ${e.message}` }));
            ws.close();
        }
    });

    ws.on('close', () => {
        console.log('Websocket kapcsolat lezárult.');
        if (targetSocket && !targetSocket.destroyed) {
            targetSocket.destroy();
        }
    });

    ws.on('error', (err) => {
        console.error(`Websocket hiba: ${err.message}`);
        if (targetSocket && !targetSocket.destroyed) {
            targetSocket.destroy();
        }
    });
});
