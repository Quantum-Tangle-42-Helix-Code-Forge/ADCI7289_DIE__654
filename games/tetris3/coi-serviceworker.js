/*! coi-serviceworker v0.1.7 (Corrected for 204/304 and Paddle bypass) */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) return;
        if (ev.data.type === "deregister") {
            self.registration.unregister().then(() => self.clients.matchAll()).then(clients => {
                clients.forEach((client) => client.navigate(client.url));
            });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;

        // --- CORRECTIF 1 : BYPASS TOTAL POUR PADDLE ET CLOUDFLARE BEACONS ---
        // On ne touche absolument pas à ces requêtes pour éviter les erreurs CORS et 204
        if (r.url.includes("cdn-cgi/rum")) {
            return; 
        }

        if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, { credentials: "omit" })
            : r;

        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) return response;

                    const newHeaders = new Headers(response.headers);
                    // On définit les règles de sécurité de base
                    newHeaders.set("Cross-Origin-Embedder-Policy", coepCredentialless ? "credentialless" : "require-corp");
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
                    
                    // FORCE la permission Cross-Origin pour débloquer le CSS de Paddle
                    newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

                    // --- CORRECTIF 2 : GESTION DES RÉPONSES SANS CORPS (204, 304, etc.) ---
                    // Obligatoire pour éviter "Response with null body status cannot have body"
                    if (response.status === 204 || response.status === 304) {
                        return new Response(null, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: newHeaders,
                        });
                    }

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });

} else {
    (() => {
        const coi = {
            shouldRegister: () => true,
            shouldDeregister: () => false,
            coepCredentialless: () => !(window.chrome || window.netscape),
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };
        const n = navigator;
        if (n.serviceWorker && n.serviceWorker.controller) {
            n.serviceWorker.controller.postMessage({ type: "coepCredentialless", value: coi.coepCredentialless() });
            if (coi.shouldDeregister()) n.serviceWorker.controller.postMessage({ type: "deregister" });
        }
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;
        if (!window.isSecureContext) return;
        if (n.serviceWorker) {
            n.serviceWorker.register(window.document.currentScript.src).then((registration) => {
                registration.addEventListener("updatefound", () => coi.doReload());
                if (registration.active && !n.serviceWorker.controller) coi.doReload();
            });
        }
    })();
}
