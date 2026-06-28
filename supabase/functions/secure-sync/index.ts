import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { gameValidators } from "./validators.ts" // IMPORT DU MODULE


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // 1. Gestion du Preflight (OBLIGATOIRE pour CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 2. Vérification du Token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
		console.error("❌ Erreur : Header Authorization absent");

		return new Response(JSON.stringify({ error: "No auth header" }), { status: 401, headers: corsHeaders })
	}

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    
    if (authError || !user) {
		console.error("❌ Erreur Auth Supabase :", authError?.message);
		return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: corsHeaders })
    }
    console.log("✅ Utilisateur authentifié :", user.id);

    // 3. Lecture du corps de la requête
    const { game_slug, new_data } = await req.json()
    if (!game_slug || !new_data) {
		return new Response(JSON.stringify({ error: "Missing payload" }), { status: 400, headers: corsHeaders })
    }

    // 4. Récupération de l'ancienne sauvegarde
    const { data: oldRow } = await supabaseAdmin
		.from('user_game_data')
		.select('data')
		.eq('user_id', user.id)
		.eq('game_slug', game_slug)
		.maybeSingle()

    const oldData = oldRow?.data || null

    // --- LOGIQUE DE SÉCURITÉ ---

    // A. Anti-Rejeu (Timestamp) - S'applique à TOUS les jeux
    // On vérifie en premier pour rejeter les requêtes inutiles
    const newTs = Number(new_data.saved_at) || 0;
    const oldTs = Number(oldData?.saved_at) || 0; // oldData peut être null au 1er jeu

    if (oldTs !== 0 && newTs <= oldTs) {
      console.log(`[Abort] Old timestamp: New(${newTs}) <= Old(${oldTs})`);
      return new Response(JSON.stringify({ status: "ignored", reason: "old_timestamp" }), { 
        status: 200, // On renvoie 200 car ce n'est pas une "erreur" serveur, juste une requête inutile
        headers: corsHeaders 
      });
    }

    // B. Appel du Validateur Spécifique (s'il existe)
    const validator = gameValidators[game_slug];
    if (validator) {
      const check = validator(oldData, new_data);
      if (!check.valid) {
        console.warn(`🚨 Triche détectée [${game_slug}] : ${check.reason}`);
        return new Response(JSON.stringify({ error: "Validation failed", reason: check.reason }), { 
          status: 403, 
          headers: corsHeaders 
        });
      }
    }

    // C. Sécurité Générique (Gains de bananes)
    // Utile comme filet de sécurité si tu oublies de configurer un validator
    const newBananes = Number(new_data.bananes) || 0;
    const oldBananes = Number(oldData?.bananes) || 0;
    if (newBananes - oldBananes > 1000) {
      return new Response(JSON.stringify({ error: "Abnormal gain" }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    // 5. Tout est OK -> Enregistrement
    const { error: upsertError } = await supabaseAdmin
      .from('user_game_data')
      .upsert({
        user_id: user.id,
        game_slug: game_slug,
        data: new_data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,game_slug' });

    if (upsertError) throw upsertError;

    return new Response(JSON.stringify({ status: "success" }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
    
    } catch (err) {
    console.error("Crash Secure Sync:", err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
