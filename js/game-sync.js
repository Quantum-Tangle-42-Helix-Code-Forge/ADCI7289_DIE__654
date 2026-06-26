// js/game-sync.js
import { supabaseClient } from "./config.js?v=1.0.3"; 

export const GameSync = {
    /**
     * Tente de charger les données depuis le Cloud, 
     * sinon se rabat sur le LocalStorage.
     */
    async load(gameSlug) {
        try {
            // 1. Récupération de l'utilisateur
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
            
            // On récupère toujours le local en backup
            const localData = JSON.parse(localStorage.getItem(`save_${gameSlug}`));

            if (authError || !user) {
                console.warn("👤 Mode Invité ou erreur Auth. Utilisation du local.");
                return localData; // Peut être null si première partie
            }

            // 2. Récupération Cloud
            const { data, error } = await supabaseClient
                .from('user_game_data')
                .select('data, updated_at')
                .eq('user_id', user.id)
                .eq('game_slug', gameSlug)
                .maybeSingle();

            if (error) throw error;

            if (data && data.data) {
                // On a des données Cloud. On met à jour le LocalStorage pour la prochaine fois
                localStorage.setItem(`save_${gameSlug}`, JSON.stringify(data.data));
                return data.data;
            }

            // Si pas de données Cloud, on renvoie le local
            return localData;

        } catch (err) {
            console.error("❌ GameSync.load Error:", err.message);
            // En cas d'erreur réseau massive, on renvoie une string spéciale pour prévenir Godot
            return "NETWORK_ERROR";
        }
    },

    /**
     * Sauvegarde rapide dans le navigateur
     */
    saveLocally(gameSlug, newData) {
        if (!newData) return;
        localStorage.setItem(`save_${gameSlug}`, JSON.stringify(newData));
    },

    /**
     * Envoie le LocalStorage vers Supabase (Upsert)
     */
    async sync(gameSlug) {
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;

            const localData = JSON.parse(localStorage.getItem(`save_${gameSlug}`));
            if (!localData) return;

            // L'upsert utilise la contrainte UNIQUE(user_id, game_slug) créée en étape 1
            const { error } = await supabaseClient
                .from('user_game_data')
                .upsert({ 
                    user_id: user.id, 
                    game_slug: gameSlug, 
                    data: localData,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,game_slug' });

            if (error) throw error;
            console.log(`☁️ Synchro Cloud réussie pour ${gameSlug}`);

        } catch (err) {
            console.error("❌ GameSync.sync Error:", err.message);
        }
    }
};
