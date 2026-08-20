import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Authorization header manquant');

    // Initialisation du client Supabase avec le jeton de l'utilisateur
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Vérification du JWT
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error('Utilisateur non authentifié');

    const { price_id, game_slug } = await req.json();

    // Génération d'un token à durée de vie limitée (ex: via un identifiant unique / UUID)
    const checkout_token = crypto.randomUUID();

    // Enregistrement dans une table 'checkout_tokens' (expire_at = now() + 5 minutes)
    const { error: dbError } = await supabaseClient
      .from('checkout_sessions')
      .insert({
        token: checkout_token,
        user_id: user.id,
        user_email: user.email,
        price_id: price_id,
        game_slug: game_slug,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      });

    if (dbError) throw dbError;

    const checkout_url = `https://aks6.ink/checkout.html?checkout_token=${checkout_token}`;

    return new Response(
      JSON.stringify({ checkout_url: checkout_url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
