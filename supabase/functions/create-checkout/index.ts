import { createClient } from "npm:@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    // 1. On récupère le price_id ET l'url actuelle du joueur depuis la requête du frontend
    const { price_id, current_url } = await req.json();
    if (!price_id) {
      return new Response(JSON.stringify({ error: "Missing price_id" }), { status: 400, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Recherche du produit
    const { data: product, error: productError } = await supabaseAdmin
      .from("store_products")
      .select("id")
      .eq("price_id", price_id)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: `Product not found` }), { status: 400, headers: corsHeaders });
    }

    // Insertion de l'intention de paiement
    const { data: intent, error: intentError } = await supabaseAdmin
      .from("payment_intents")
      .insert([{ user_id: user.id, store_product_id: product.id, status: "pending" }])
      .select()
      .single();

    if (intentError) throw new Error("Intent insertion failed");

    const paddleSecretKey = Deno.env.get("PADDLE_API_KEY");
    if (!paddleSecretKey) throw new Error("Paddle API key is missing on Supabase.");

    // 2. Appel à Paddle en lui passant dynamiquement l'adresse de retour
    // Si current_url n'est pas fourni, on met ta racine par défaut
    const finalReturnUrl = current_url || "https://www.aksess-games.com";

    const paddleResponse = await fetch("https://sandbox-api.paddle.com/transactions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${paddleSecretKey}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        items: [{ price_id: price_id, quantity: 1 }],
        checkout: {
          return_url: finalReturnUrl // <-- MAGIE : Paddle sait maintenant exactement d'où vient le joueur !
        },
        custom_data: { user_id: user.id, payment_intent_id: intent.id }
      })
    });

    const paddleData = await paddleResponse.json();
   
    if (!paddleResponse.ok) {
      console.error("[PADDLE ERROR]", paddleData);
      throw new Error(paddleData.error?.detail || "Paddle API Error");
    }
    
    // Sauvegarder les informations Paddle dans payment_intents
	const { error: updateError } = await supabaseAdmin
	  .from("payment_intents")
	  .update({
		paddle_transaction_id: paddleData.data.id,
		checkout_id: paddleData.data.checkout?.id ?? null,
		checkout_url: paddleData.data.checkout?.url ?? null
	  })
	  .eq("id", intent.id);

	if (updateError) {
	  throw updateError;
	}

    return new Response(
      JSON.stringify({ 
        transaction_id: paddleData.data.id,
        checkout_url: paddleData.data.checkout?.url 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err.message || err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
