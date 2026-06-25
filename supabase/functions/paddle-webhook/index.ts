// supabase/functions/paddle-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async (req) => {
  try {
    const body = await req.json()
    if (body.event_type !== "transaction.completed") return new Response("Ignored");

    const { user_id, payment_intent_id } = body.data.custom_data;
    const paddleTransactionId = body.data.id;
    const currencyCode = body.data.currency_code || "USD";

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Récupérer l'intention et le montant de la récompense
    const { data: intent } = await supabaseAdmin
      .from('payment_intents')
      .select(`id, status, store_products(reward_amount, reward_type)`)
      .eq('id', payment_intent_id)
      .single();

    if (intent && intent.status !== 'completed') {
      // 2. Marquer l'intention comme payée
      await supabaseAdmin.from('payment_intents').update({ status: 'completed' }).eq('id', payment_intent_id);

      // 3. CRÉDITER LE COMPTE (La seule source de vérité)
      // On ajoute une colonne 'processed' (boolean) pour savoir si le jeu a déjà compté ces pièces
      await supabaseAdmin.from('wallet_transactions').insert({
	  user_id: user_id,
	  amount: intent.store_products.reward_amount,
	  type: 'credit',
	  currency: currencyCode,
	  description: "Achat : " + intent.store_products.reward_type,
	  reference_id: body.data.id,
	  metadata: { 
		processed: false, 
		reward_type: intent.store_products.reward_type // TRÈS IMPORTANT
	  }
	});
    }
    return new Response("OK", { status: 200 });
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
})
