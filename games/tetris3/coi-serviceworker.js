/*! coi-serviceworker v0.1.7 - UNIVERSAL VERSION (Chrome, Opera, Firefox, Safari) */
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("fetch", (event) => {
        const url = event.request.url;

        // --- BYPASS UNIQUEMENT POUR CLOUDFLARE RUM (Erreur 204) ---
        if (url.includes("cdn-cgi/rum")) {
            return;
        }
        
        // Si c'est Paddle, on force le mode opaque/no-cors pour éviter le blocage CORP
		if (request.url.includes("paddle.com")) {
			request = new Request(request.url, {
				mode: "no-cors",
				credentials: "omit"
			});
		}

        if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
            return;
        }

        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Si la réponse est opaque (status 0), on ne peut pas la modifier, on la renvoie telle quelle
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    
                    // HEADERS CRITIQUES POUR GODOT (SharedArrayBuffer)
                    newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
                    
                    // HEADER CRITIQUE POUR PADDLE ET RESSOURCES EXTERNES
                    // Autorise le chargement de ressources depuis d'autres domaines
                    newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

                    // GESTION DES RÉPONSES SANS CORPS (204, 304)
                    if (response.status === 204 || response.status === 304) {
                        return new Response(null, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: newHeaders,
                        });
                    }

                    // RÉPONSE NORMALE : On crée une nouvelle réponse avec les en-têtes injectés
                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => {
                    console.error("SW Fetch Error:", e);
                    // En cas d'échec total, on essaie de renvoyer la requête d'origine
                    return fetch(event.request);
                })
        );
    });

} else {
    // --- PARTIE CLIENT : ENREGISTREMENT ET FORCE ISOLATION ---
    (() => {
        const n = navigator;
        if (n.serviceWorker) {
            n.serviceWorker.register(window.document.currentScript.src).then((registration) => {
                registration.addEventListener("updatefound", () => window.location.reload());
                if (registration.active && !n.serviceWorker.controller) window.location.reload();
            });
        }

        // Si après chargement le navigateur dit "non isolé", on force le rechargement
        if (window.crossOriginIsolated === false && n.serviceWorker.controller) {
            window.location.reload();
        }
    })();
}
