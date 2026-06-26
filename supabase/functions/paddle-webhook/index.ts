import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async (req) => {
  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Paddle-Signature");

    if (!signatureHeader) {
      return new Response("Missing Paddle-Signature", { status: 401 });
    }

    /**
     * Fonction de comparaison en temps constant pour éviter les Timing Attacks
     */
    function timingSafeEqual(a: string, b: string): boolean {
      if (a.length !== b.length) return false;
      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
      }
      return result === 0;
    }

    /**
     * Vérification de la signature Paddle avec fenêtre de temps
     */
    async function verifySignature(
      body: string,
      header: string,
      secret: string
    ) {
      const parts = Object.fromEntries(
        header.split(";").map(p => p.split("="))
      );

      const timestamp = parts.ts;
      const receivedHash = parts.h1;

      if (!timestamp || !receivedHash) return false;

      // 1. PROTECTION : Vérifier que le timestamp n'est pas trop vieux (tolérance 5s)
      const now = Math.floor(Date.now() / 1000);
      const requestTime = parseInt(timestamp);
      if (Math.abs(now - requestTime) > 5) {
        console.error("❌ Webhook trop vieux (Replay Attack possible)");
        return false;
      }

      // 2. RE-SIGNATURE
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const payload = `${timestamp}:${body}`;
      const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      
      const expectedHash = Array.from(new Uint8Array(signed))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      // 3. PROTECTION : Comparaison en temps constant
      return timingSafeEqual(expectedHash, receivedHash);
    }

    const webhookSecret = Deno.env.get("PADDLE_WEBHOOK_SECRET")!;
    const isSignatureValid = await verifySignature(rawBody, signatureHeader, webhookSecret);

    if (!isSignatureValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const body = JSON.parse(rawBody);

    if (body.event_type === "transaction.completed") {
      const data = body.data;
      const customData = data.custom_data;
      
      const userId = customData?.user_id;
      const intentId = customData?.payment_intent_id;

      if (!userId || !intentId) {
        return new Response("Missing custom_data", { status: 400 });
      }

      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      // 1. Récupérer l'intention et le produit lié
      const { data: intent, error: intentError } = await supabaseAdmin
        .from('payment_intents')
        .select(`status, store_products(reward_amount, reward_type, reward_key)`)
        .eq('id', intentId)
        .single();
      
      if (intentError || !intent.store_products) {
        throw new Error("Product or Intent not found");
      }

      // 2. IDEMPOTENCE : On ne traite que si c'est 'pending'
      const { data: updatedIntent } = await supabaseAdmin
        .from("payment_intents")
        .update({
          status: "completed",
          completed_at: new Date().toISOString()
        })
        .eq("id", intentId)
        .eq("status", "pending") // Sécurité cruciale contre le double-clic
        .select()
        .maybeSingle();
      
      if (!updatedIntent) {
        return new Response("Already processed", { status: 200 });
      }

      // 3. CALCUL DES RÉCOMPENSES (Quantité comprise)
      const quantity = data.items?.[0]?.quantity || 1;
      const totalReward = (intent.store_products.reward_amount ?? 0) * quantity;

      // 4. CRÉDITER LE COMPTE (Ledger)
      const { error: walletError } = await supabaseAdmin.from('wallet_transactions').insert({
        user_id: userId,
        amount: totalReward,
        type: 'credit',
        currency: data.currency_code || "USD",
        description: `Achat boutique : ${quantity}x ${intent.store_products.reward_type}`,
        reference_id: data.id, // On utilise l'ID Paddle pour empêcher les doublons SQL
        metadata: { 
          processed: false, 
          reward_type: intent.store_products.reward_type,
          reward_key: intent.store_products.reward_key
        }
      });

      if (walletError) {
        // Si l'ID de transaction existe déjà, PostgreSQL renverra l'erreur 23505
        if (walletError.code === "23505") {
          return new Response("Already credited", { status: 200 });
        }
        throw walletError;
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Ignored event", { status: 200 });

  } catch (err) {
    console.error("💥 Webhook Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})
