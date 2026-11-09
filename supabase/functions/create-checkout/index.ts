import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: corsHeaders });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Variables d'environnement Supabase manquantes." }), { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, { 
      global: { headers: { Authorization: `Bearer ${token}` } } 
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 1. DÉTECTION DU RÔLE DE L'UTILISATEUR
    const { data: adminRecord, error: adminError } = await supabaseAdmin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError) {
      console.error("[DATABASE ERROR - ADMINS CHECK]:", adminError.message);
    }

    const isAdmin = adminRecord !== null;

    // 2. CONFIGURATION DYNAMIQUE DE L'API
    const paddleApiKey = isAdmin 
      ? Deno.env.get("PADDLE_SANDBOX_API_KEY") 
      : Deno.env.get("PADDLE_PRODUCTION_API_KEY");
      
    const paddleApiUrl = isAdmin 
      ? "https://paddle.com" 
      : "https://paddle.com";

    if (!paddleApiKey) {
      return new Response(
        JSON.stringify({ error: `La clé secrète Paddle (API KEY) pour le mode ${isAdmin ? 'Sandbox' : 'Production'} est introuvable.` }),
        { status: 500, headers: corsHeaders }
      );
    }

    // 3. TRAITEMENT DE LA COMMANDE ENTRANTE
    const { price_id, current_url, game_slug } = await req.json();
    if (!price_id) {
      return new Response(JSON.stringify({ error: "Missing price_id" }), { status: 400, headers: corsHeaders });
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from("store_products")
      .select("id")
      .eq("price_id", price_id)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: `Product not found for price_id: ${price_id}` }), { status: 400, headers: corsHeaders });
    }

    const cleanGameSlug = game_slug || "default_game";

    const { data: intent, error: intentError } = await supabaseAdmin
      .from("payment_intents")
      .insert([{ 
        user_id: user.id, 
        store_product_id: product.id, 
        paddle_price_id: price_id, 
        status: "pending"
      }])
      .select()
      .single();

    if (intentError) throw new Error(`Intent insertion failed: ${intentError.message}`);

    const finalReturnUrl = current_url || "https://aksess-games.com";

    // 4. REQUÊTE VERS PADDLE
    const paddleResponse = await fetch(paddleApiUrl, {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${paddleApiKey}`,
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        items: [{ price_id: price_id, quantity: 1 }],
        checkout: {
          return_url: finalReturnUrl
        },
        custom_data: { 
          user_id: user.id, 
          payment_intent_id: intent.id,
          game_slug: cleanGameSlug,
          is_sandbox: isAdmin
        }
      })
    });

    const paddleData = await paddleResponse.json();
   
    if (!paddleResponse.ok) {
      console.error("[PADDLE API REJECTION]:", paddleData);
      await supabaseAdmin.from("payment_intents").update({ status: "error" }).eq("id", intent.id);
      return new Response(
        JSON.stringify({ error: paddleData.error?.detail || "Erreur API Paddle" }),
        { status: 400, headers: corsHeaders }
      );
    }
    
    const { error: updateError } = await supabaseAdmin
      .from("payment_intents")
      .update({
        paddle_transaction_id: paddleData.data.id,
        checkout_id: paddleData.data.checkout?.id ?? null,
        checkout_url: paddleData.data.checkout?.url ?? null,
        status: "initiated"
      })
      .eq("id", intent.id);

    if (updateError) throw updateError;

    // 5. EXPÉDITION DES LIENS ET TOKENS CLIENTS
    const paddleClientToken = isAdmin 
      ? Deno.env.get("PADDLE_SANDBOX_CLIENT_TOKEN") 
      : Deno.env.get("PADDLE_PRODUCTION_CLIENT_TOKEN");

    return new Response(
      JSON.stringify({ 
        transaction_id: paddleData.data.id,
        checkout_url: paddleData.data.checkout?.url,
        paddle_client_token: paddleClientToken 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal Server Error", details: String(err.message || err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
