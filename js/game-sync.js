import { supabaseClient } from "./config.js?v=1.0.2";

let syncTimer = null;
let syncRunning = false;
let syncQueued = false;

export const GameSync = {

    async load(gameSlug) {

        try {

            const {
                data: { user },
                error: authError
            } = await supabaseClient.auth.getUser();

            if (authError)
                throw authError;

            // récupération locale
            const localRaw = localStorage.getItem(`save_${gameSlug}`);
            const localData = localRaw ? JSON.parse(localRaw) : null;

            if (!user) {

                return localData;

            }

            const { data, error } = await supabaseClient
                .from("user_game_data")
                .select("data,updated_at")
                .eq("user_id", user.id)
                .eq("game_slug", gameSlug)
                .maybeSingle();

            if (error)
                throw error;

            if (!data) {

                return localData;

            }

            const remoteData = data.data;

            // si aucune sauvegarde locale
            if (!localData) {

                localStorage.setItem(
                    `save_${gameSlug}`,
                    JSON.stringify(remoteData)
                );

                return remoteData;

            }

            // comparaison des dates internes
            const localTime = localData.saved_at || 0;
            const remoteTime = remoteData.saved_at || 0;

            if (localTime > remoteTime) {

                console.log("📱 Sauvegarde locale plus récente.");

                return localData;

            }

            console.log("☁️ Sauvegarde cloud plus récente.");

            localStorage.setItem(
                `save_${gameSlug}`,
                JSON.stringify(remoteData)
            );

            return remoteData;

        }
        catch (err) {

            console.error(err);

            return "NETWORK_ERROR";

        }

    },

    saveLocally(gameSlug, newData) {
		newData.saved_at = Date.now();
		localStorage.setItem(
			`save_${gameSlug}`,
			JSON.stringify(newData)
		);
		this.scheduleSync(gameSlug);
	}
    
    scheduleSync(gameSlug) {
		if (syncTimer) {
			clearTimeout(syncTimer);
		}

		syncTimer = setTimeout(async () => {
			if (syncRunning) {
				syncQueued = true;
				return;
			}

			syncRunning = true;
			try {
				await this.sync(gameSlug);
			}

			finally {

				syncRunning = false;
				if (syncQueued) {
					syncQueued = false;
					this.scheduleSync(gameSlug);
				}
			}
		}, 3000);

	},

    async sync(gameSlug) {
		if (syncRunning) {
			return;
		}
		
		if (localData.save_version === lastSyncedVersion) {
			return;
		}

        try {

            const {
                data: { user }
            } = await supabaseClient.auth.getUser();

            if (!user) {

                window.on_sync_finished?.();

                return;

            }

            const localRaw = localStorage.getItem(`save_${gameSlug}`);

            if (!localRaw) {

                window.on_sync_finished?.();

                return;

            }

            const localData = JSON.parse(localRaw);

            const { error } = await supabaseClient
                .from("user_game_data")
                .upsert(
                    {
                        user_id: user.id,
                        game_slug: gameSlug,
                        data: localData
                    },
                    {
                        onConflict: "user_id,game_slug"
                    }
                );

            if (error)
                throw error;

            console.log("☁️ Synchronisation Cloud OK");
            lastSyncedVersion = localData.save_version;

            if (window.on_sync_finished)
                window.on_sync_finished("OK");

        }
        catch (err) {

            console.error("Erreur Sync :", err);

            if (window.on_sync_finished)
                window.on_sync_finished("ERROR");

        }

    }

};
