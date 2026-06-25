import { supabaseClient } from "./config.js?v=1.0.2";
		    
		    
export const GameSync = {
    // Charge depuis Supabase, sinon depuis LocalStorage
     async load(gameSlug) {
		try {
			const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
			if (authError) throw authError;

			if (!user) return null;

			const { data, error } = await supabaseClient
				.from('user_game_data')
				.select('data')
				.eq('user_id', user.id)
				.eq('game_slug', gameSlug)
				.maybeSingle();

			if (error) throw error;
			return data ? data.data : null;
		} catch (err) {
			console.error("Erreur Load:", err);
			return "NETWORK_ERROR"; // On renvoie ce texte précis à Godot
		}
	},

    // Sauvegarde immédiate dans le navigateur (très rapide)
    saveLocally(gameSlug, newData) {
        localStorage.setItem(`save_${gameSlug}`, JSON.stringify(newData));
    },

    // Envoi des données du navigateur vers Supabase
    async sync(gameSlug) {
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;

            const localData = JSON.parse(localStorage.getItem(`save_${gameSlug}`));
            if (!localData) return;

            await supabaseClient
                .from('user_game_data')
                .upsert({ 
                    user_id: user.id, 
                    game_slug: gameSlug, 
                    data: localData,
                    updated_at: new Date()
                }, { onConflict: 'user_id,game_slug' });

        } catch (err) {
            console.error("Erreur Sync Cloud:", err);
        }
    }
};
