const dns = require('dns');
const net = require("net");
const http = require("http");
const tls = require('tls'); // ÚJ: TLS/SSL támogatáshoz
const WebSocketServer = require("ws").Server;

var port = process.env.PORT || process.env.VCAP_APP_PORT || 8090;
var server = http.createServer();

server.on("request", (req, res) => {
    // ... (HTTP válasz logika változatlan)
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebSocket Proxy Server is Running\n");
});

server.listen(port, () => {
    console.log("http server listening on %d", port);
});

var wss = new WebSocketServer({ server: server });

wss.on("connection", function (ws) {
    let client; // client deklarálása a kód elején
    let addr; 
    let is_connected = false;

    // --- Eseménykezelők definiálása (függetlenül a net/tls-től) ---

    function setup_client_events() {
        client.on("connect", function () {
            is_connected = true;
            if (addr && addr.ipv4) {
                 ws.send(addr.ipv4);
            }
        });

        client.on("error", function (ex) {
            console.log("❌ TCP/TLS Socket hiba: " + ex.message);
            if (ws.readyState == ws.OPEN) ws.close();
        });

        client.on("data", function (data) {
            console.log("--- Adat érkezett a cél szervertől, méret:", data.length); 
            if (ws.readyState == ws.OPEN) {
                // Fontos: a tls/net modulok bináris bájtokat adnak át, ezt küldjük tovább
                ws.send(data); 
            }
        });

        client.on("close", function () {
            console.log("TCP/TLS kapcsolat lezárva a célhoszt felé.");
            if (ws.readyState == ws.OPEN) ws.close();
        });
    }

    // --- Websocket Üzenetkezelő ---

    ws.on("message", function incoming(message, isBinary) {
        
        if (isBinary == true) {
            // BINÁRIS ADAT: A nyers HTTP/HTTPS kérés. Továbbítjuk a célhoszt felé.
            if (client && is_connected) {
                client.write(message);
            } else {
                console.log("⚠️ Próbálkozás bináris küldéssel, de a client nincs csatlakoztatva.");
            }
        }
        
        if (isBinary == false) {
            // STRING ADAT: Ez a JSON parancs a TCP kapcsolat nyitására.
            console.log("WS: Parancs érkezett: " + message);
            
            try {
                addr = JSON.parse(message);
            } catch (e) {
                console.error("JSON parse hiba:", e.message);
                return ws.close();
            }

            if (addr.type == "tcp") {
                dns.lookup(addr.host, 4, (err, address, family) => {
                    if (err) {
                        console.error("DNS feloldási hiba:", err.message);
                        return ws.close();
                    }
                    
                    addr.ipv4 = address;

                    // *** FONTOS LOGIKA: VÁLASZTÁS NET ÉS TLS KÖZÖTT ***
                    if (addr.port == 443) {
                        // HTTPS kérés: TLS kapcsolatot nyitunk
                        console.log(`Nyitás TLS (HTTPS) kapcsolaton: ${addr.host}:${addr.port}`);
                        client = tls.connect(addr.port, addr.ipv4, { 
                            // Ez megakadályozza a szigorú SSL tanúsítvány ellenőrzést, 
                            // ami néha gondot okozhat felhőkörnyezetben.
                            checkServerIdentity: () => undefined 
                        });
                    } else {
                        // HTTP kérés: Net kapcsolatot nyitunk
                        console.log(`Nyitás NET (HTTP) kapcsolaton: ${addr.host}:${addr.port}`);
                        client = new net.Socket();
                        client.connect(addr.port, addr.ipv4);
                    }
                    
                    // Csatoljuk az eseménykezelőket az új client objektumhoz
                    setup_client_events();
                });
            }
        }
    });

    ws.on("close", function () {
        console.log("Websocket kapcsolat lezárult.");
        if (client) client.destroy();
    });

    ws.on("error", function (ex) {
        console.log("❌ Websocket hiba: " + ex.message);
    });
});
