import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async (req) => {
  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Paddle-Signature");

    if (!signatureHeader) return new Response("No Signature", { status: 401 });

    // 1. PARSE PRÉVENTIF DU CORPS POUR DÉTECTER L'ENVIRONNEMENT
    const body = JSON.parse(rawBody);
    const isSandbox = body.data?.custom_data?.is_sandbox === true;

    // 2. SÉLECTION DYNAMIQUE DU SECRET DE WEBHOOK
    const webhookSecret = isSandbox 
      ? Deno.env.get("PADDLE_SANDBOX_WEBHOOK_SECRET") 
      : Deno.env.get("PADDLE_PRODUCTION_WEBHOOK_SECRET");

    if (!webhookSecret) {
      throw new Error(`Secret de webhook manquant pour le mode : ${isSandbox ? 'Sandbox' : 'Production'}`);
    }

    // 3. VÉRIFICATION DE LA SIGNATURE SECURITY
    const parts = Object.fromEntries(signatureHeader.split(";").map(p => p.split("=")));
    const timestamp = parts.ts;
    const receivedHash = parts.h1;

    if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp)) > 300) {
      return new Response("Expired", { status: 401 });
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}:${rawBody}`));
    const expectedHash = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, "0")).join("");

    if (expectedHash !== receivedHash) return new Response("Invalid Signature", { status: 401 });

    // 4. INFOS DE BASE APRÈS VALIDATION
    const eventType = body.event_type;
    const data = body.data;
    const intentId = data.custom_data?.payment_intent_id;
    const userId = data.custom_data?.user_id;

    if (!intentId) return new Response("Ignored: No intent_id", { status: 200 });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // --- BRANCHEMENT SELON L'ÉVÉNEMENT ---

    // CAS 1 : TRANSACTION RÉUSSIE (On donne les récompenses)
    if (eventType === "transaction.completed") {
      
      const { data: intent, error: intentError } = await supabaseAdmin
        .from('payment_intents')
        .select(`status, store_products(reward_amount, reward_type)`)
        .eq('id', intentId)
        .single();
      
      if (intentError || !intent.store_products) throw new Error("Product not found");

      const { data: updatedIntent } = await supabaseAdmin
        .from("payment_intents")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq('id', intentId)
        .in('status', ['pending', 'initiated'])
        .select().maybeSingle();
      
      if (!updatedIntent) {
        console.log("ℹ️ Transaction déjà traitée ou statut incompatible.");
        return new Response("Already Processed", { status: 200 });
      }

      const quantity = data.items?.[0]?.quantity || 1;
      const reward = intent.store_products;
      const totalAmount = (reward.reward_amount || 0) * quantity;

      // Insertion Wallet
      const { error: wErr } = await supabaseAdmin.from('wallet_transactions').insert({
        user_id: userId,
        amount: Math.round(totalAmount),
        currency: data.currency_code || "USD",
        source: "paddle",
        type: "credit",
        description: `Achat : ${quantity}x ${reward.reward_type} (${isSandbox ? 'TEST' : 'LIVE'})`,
        reference_id: data.id,
        metadata: { processed: false, reward_type: reward.reward_type, is_sandbox: isSandbox }
      });
      if (wErr) console.error("Erreur Wallet:", wErr);

      // Insertion Item Purchases
      const { error: iErr } = await supabaseAdmin.from('item_purchases').insert({
        user_id: userId,
        item_id: reward.reward_type,
        paddle_order_id: data.id,
        delivered: false
      });
      
      if (iErr) console.error("Erreur Items:", iErr);
      console.log(`✅ Transaction ${data.id} complétée (${isSandbox ? 'Sandbox' : 'Production'}) pour l'utilisateur ${userId}`);
    }

    // CAS 2 : TRANSACTION ANNULÉE
    else if (eventType === "transaction.canceled") {
      console.log(`🚫 Transaction ${data.id} annulée par l'utilisateur.`);
      await supabaseAdmin
        .from("payment_intents")
        .update({ status: "canceled" })
        .eq('id', intentId)
        .in('status', ['pending', 'initiated']);
    }

    // CAS 3 : PAIEMENT ÉCHOUÉ
    else if (eventType === "transaction.past_due" || eventType === "transaction.payment_failed") {
      console.log(`❌ Paiement échoué pour la transaction ${data.id}`);
      await supabaseAdmin
        .from("payment_intents")
        .update({ status: "failed" })
        .eq('id', intentId);
    }

    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("💥 CRASH WEBHOOK :", err.message);
    return new Response(err.message, { status: 500 });
  }
});
