const dns = require('dns');
const net = require("net");
const http = require("http");
const WebSocketServer = require("ws").Server;

// A PORT beállítás a környezeti változókból (Render.com), vagy alapértelmezetten 8090
var port = process.env.PORT || process.env.VCAP_APP_PORT || 8090;
var server = http.createServer();

server.on("request", (req, res) => {
    res.on("error", (err) => {
        console.error("HTTP válasz hiba:", err);
    });

    // Egyszerű "Hello World" válasz az alap URL-re
    if (req.url == "/now") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write(JSON.stringify({ now: new Date() }));
        res.end();
    } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("WebSocket Proxy Server is Running\n"); // Jelezzük, hogy a webszerver fut
        res.end("Hello World\n");
    }
});

server.listen(port, () => {
    console.log("http server listening on %d", port);
});

// Websocket Szerver inicializálása a HTTP szerveren belül
var wss = new WebSocketServer({ server: server });

wss.on("connection", function (ws) {
    let client = new net.Socket();
    let addr; // A cél hoszt és port tárolására

    // 1. Esemény: Sikerült TCP kapcsolatot nyitni a távoli szerverhez (pl. httpbin.org)
    client.on("connect", function () {
        // Visszaküldjük a sikeresen feloldott IP-címet a kliensnek
        if (addr && addr.ipv4) {
             ws.send(addr.ipv4);
        }
    });

    // 2. Esemény: Hiba a TCP kapcsolatban (pl. a célhoszt elutasította)
    client.on("error", function (ex) {
        console.log("❌ TCP Socket hiba: " + ex.message);
        ws.close();
    });

    // 3. Esemény: Adat érkezik a távoli szerverről (ez a HTTP válasz!)
    client.on("data", function (data) {
        // DEBUG LOG: Látni fogjuk a Render logban, hogy érkezett-e adat
        console.log("--- Adat érkezett a cél szervertől, méret:", data.length); 
        
        if (ws.readyState == ws.OPEN) {
            // Visszaküldjük a nyers adatot a Websocket kliensnek (fontos, hogy binárisan)
            ws.send(data); 
        }
    });

    // 4. Esemény: A TCP kapcsolat lezárul
    client.on("close", function () {
        console.log("TCP kapcsolat lezárva a célhoszt felé.");
        ws.close();
        client.destroy();
    });

    // 5. Esemény: Adat érkezik a Websocket kliensről (parancsok és kérések)
    ws.on("message", function incoming(message, isBinary) {
        // Ha bináris adat jön (ez az aktuális HTTP kérés)
        if (isBinary == true) {
            // Csak továbbítjuk a TCP csatornán a távoli szerver felé
            client.write(message);
        }
        
        // Ha string adat jön (ez a parancs a TCP kapcsolat nyitására, pl. '{"type": "tcp", "host": "...", "port": ...}')
        if (isBinary == false) {
            console.log("WS: Parancs érkezett: " + message);
            
            try {
                addr = JSON.parse(message);
            } catch (e) {
                console.error("JSON parse hiba:", e);
                ws.close();
                return;
            }

            // TCP kapcsolat nyitása parancs
            if (addr.type == "tcp") {
                // DNS feloldás: hostname -> IP-cím
                dns.lookup(addr.host, 4, (err, address, family) => {
                    if (err) {
                        console.error("DNS feloldási hiba:", err.message);
                        return ws.close();
                    }
                    
                    addr.ipv4 = address;
                    // Nyitjuk a TCP kapcsolatot a feloldott IP-címre
                    client.connect(addr.port, addr.ipv4);
                });
            }
        }
    });

    // 6. Esemény: A Websocket kapcsolat lezárul
    ws.on("close", function () {
        console.log("Websocket kapcsolat lezárult.");
        client.destroy();
    });

    // 7. Esemény: Websocket hiba
    ws.on("error", function (ex) {
        console.log("❌ Websocket hiba: " + ex.message);
    });
});
