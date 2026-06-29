import { supabaseClient, SAVE_SALT } from "./config.js";

let syncTimer = null;
let isSyncDisabled = false;


export const GameSync = {
	
	// Fonction interne pour générer une signature
	async generateSignature(dataString) {
		const encoder = new TextEncoder();
		const keyData = encoder.encode(SAVE_SALT);
		const msgData = encoder.encode(dataString);
		
		const cryptoKey = await crypto.subtle.importKey(
			"raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
		);
		
		const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
		return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
	},

     async load(gameSlug) {
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            const localRaw = localStorage.getItem(`save_${gameSlug}`);
            
            let localData = null;
            if (localRaw) {
                const envelope = JSON.parse(localRaw);
                // Si c'est une ancienne sauvegarde sans signature, on accepte pour cette fois ou on refuse
                if (!envelope.signature) {
                    localData = envelope; 
                } else {
                    // VERIFICATION DU SCEAU
                    const expectedSignature = await this.generateSignature(JSON.stringify(envelope.payload));
                    if (envelope.signature === expectedSignature) {
                        localData = envelope.payload;
                    } else {
                        console.error("🚨 ALERTE TRICHE : La signature locale est invalide !");
                        return "TAMPERED_ERROR"; // On prévient Godot
                    }
                }
            }

            if (!user) return localData;

            // Chargement Cloud
            const { data, error } = await supabaseClient.from("user_game_data").select("data").eq('user_id', user.id).eq('game_slug', gameSlug).maybeSingle();
            if (error) throw error;

            if (data && data.data) {
                // Ici aussi on pourrait vérifier une signature cloud si on veut être paranoïaque
                localStorage.setItem(`save_${gameSlug}`, JSON.stringify({
                    payload: data.data,
                    signature: await this.generateSignature(JSON.stringify(data.data))
                }));
                return data.data;
            }

            return localData;
        } catch (err) {
            console.error("Load Error:", err);
            return "NETWORK_ERROR";
        }
    },
	
	async scheduleSync(gameSlug) {
		if(isSyncDisabled)
			return;
		// 1. Annuler le décompte précédent s'il existe
		if (syncTimer) clearTimeout(syncTimer);

		// 2. Lancer un nouveau décompte de 3 secondes
		syncTimer = setTimeout(() => {
			this.sync(gameSlug);
		}, 3000);
	},

    async saveLocally(gameSlug, newData) {
		if(isSyncDisabled)
			return;
        newData.saved_at = Date.now();
        const dataString = JSON.stringify(newData);
        
        // On génère le sceau
        const signature = await this.generateSignature(dataString);
        
        // On enregistre l'enveloppe complète
        const envelope = {
            payload: newData,
            signature: signature
        };
        
        localStorage.setItem(`save_${gameSlug}`, JSON.stringify(envelope));
        this.scheduleSync(gameSlug);
    },
	
	async deleteData(gameSlug) {
		try {
			const { data: { user } } = await supabaseClient.auth.getUser();
			
			// 1. Supprimer du LocalStorage (Navigateur)
			localStorage.removeItem(`save_${gameSlug}`);

			if (user) {
				// 2. Supprimer de Supabase (Cloud)
				const { error } = await supabaseClient
					.from('user_game_data')
					.delete()
					.eq('user_id', user.id)
					.eq('game_slug', gameSlug);

				if (error) throw error;
			}
			
			console.log(`🗑️ Données supprimées pour ${gameSlug}`);
			return "OK";
		} catch (err) {
			console.error("❌ Erreur suppression :", err.message);
			return "ERROR";
		}
	},
	
	// À ajouter dans l'objet GameSync :
	async verifyLocalSignature(gameSlug, envelope) {
		if (!envelope || !envelope.signature || !envelope.payload) return false;
		try {
			const expected = await this.generateSignature(JSON.stringify(envelope.payload));
			return envelope.signature === expected;
		} catch (e) {
			return false;
		}
	},

// Assure-toi que generateSignature est accessible (en dehors de l'export ou en méthode interne)

    async sync(gameSlug) {
		if (isSyncDisabled === true) return;
		
		try {
			// 1. Vérifier si l'utilisateur est connecté
			const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
			if (sessionError || !session) {
				console.warn("☁️ Pas de session active, synchro cloud ignorée.");
				return;
			}

			// 2. Récupérer la donnée locale brute
			const localRaw = localStorage.getItem(`save_${gameSlug}`);
			if (!localRaw) return; // Rien à sauvegarder
			
			 // On récupère l'enveloppe signée (Niveau 1)
			const envelope = JSON.parse(localRaw);
			const dataToSend = envelope.payload || envelope; 

			// 3. Écraser sur Supabase (Simple Upsert)
			// APPEL DE LA FONCTION SÉCURISÉE AU LIEU DE L'UPSERT DIRECT
			const { data, error } = await supabaseClient.functions.invoke('secure-sync', {
				body: { 
					game_slug: gameSlug, 
					new_data: dataToSend 
				},
				headers: {
					Authorization: `Bearer ${session.access_token}`
				}
			});

			if (error) {
				const err = error;
				// On cherche le status 403 partout où il peut se cacher
				const statusCode = err.status || (err.context ? err.context.status : null);
				
				console.warn("📥 Erreur Serveur détectée, Status:", statusCode);

				if (statusCode === 403 || statusCode === 401 || err.message?.includes("403")) {
					console.error("🚨 FUSIBLE SAUTÉ : Le serveur a rejeté la sauvegarde (Sécurité).");
					isSyncDisabled = true; // ON COUPE LE COURANT
					
					if (syncTimer) {
						clearTimeout(syncTimer);
						syncTimer = null;
					}
					
					window.on_sync_finished?.("FORBIDDEN"); // On prévient Godot
					return;
				}
				throw err;
			}
			console.log("☁️ Sauvegarde Cloud réussie.");
			window.on_sync_finished?.("OK");
		} catch (err) {
			console.error("❌ Erreur SECURE-SYNC :", err.message);
			if (err.message?.includes("403")) {
				isSyncDisabled = true;
				window.on_sync_finished?.("FORBIDDEN");
			}
		}
	}

};
