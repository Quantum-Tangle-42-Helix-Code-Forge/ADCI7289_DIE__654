import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const userLastSyncMap = new Map<string, number>();
const MIN_SYNC_INTERVAL_MS = 3000;

// --- LOGIQUE DE VALIDATION DYNAMIQUE ---

function getSavedAt(data: any): number {
  if (!data) return 0;
  if (data.metadata && data.metadata.saved_at) {
    return Number(data.metadata.saved_at) || 0;
  }
  return Number(data.saved_at) || 0;
}

function getValueFromData(path: string, data: any): any {
  if (!data) return undefined;

  if (path.includes('.')) {
    const parts = path.trim().split('.');
    let current = data;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  let foundValue: any = undefined;

  function search(obj: any) {
    if (!obj || typeof obj !== 'object' || foundValue !== undefined) return;

    if (Object.prototype.hasOwnProperty.call(obj, path)) {
      foundValue = obj[path];
      return;
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        search(obj[key]);
      }
    }
  }

  search(data);
  return foundValue;
}

function evaluateExpression(expr: string, data: any): number {
  expr = expr.trim();
  if (!isNaN(Number(expr))) return Number(expr);

  if (expr.includes('*')) {
    const [varName, multiplier] = expr.split('*').map(s => s.trim());
    const val = Number(getValueFromData(varName, data)) || 0;
    const mult = Number(multiplier) || 1;
    return val * mult;
  }

  if (expr.includes('+')) {
    const [varName, adder] = expr.split('+').map(s => s.trim());
    const val = Number(getValueFromData(varName, data)) || 0;
    const add = Number(adder) || 0;
    return val + add;
  }

  return Number(getValueFromData(expr, data)) || 0;
}

function validateDynamicRules(rules: string[], newData: any): { valid: boolean; reason?: string } {
  for (const rule of rules) {
    const operatorMatch = rule.match(/(<=|>=|==|!=|<|>)/);
    if (!operatorMatch) continue;

    const op = operatorMatch[0];
    const [leftPart, rightPart] = rule.split(op).map(s => s.trim());

    const leftValue = Number(getValueFromData(leftPart, newData));
    const rightValue = evaluateExpression(rightPart, newData);

    if (isNaN(leftValue)) continue;

    let isValid = true;
    switch (op) {
      case '<=': isValid = leftValue <= rightValue; break;
      case '>=': isValid = leftValue >= rightValue; break;
      case '==': isValid = leftValue === rightValue; break;
      case '!=': isValid = leftValue !== rightValue; break;
      case '<':  isValid = leftValue < rightValue; break;
      case '>':  isValid = leftValue > rightValue; break;
    }

    if (!isValid) {
      return {
        valid: false,
        reason: `Règle violée : ${leftPart} (${leftValue}) ${op} ${rightPart} (${rightValue})`
      };
    }
  }
  return { valid: true };
}

// Fonction utilitaire pour appliquer le bannissement complet
async function banUser(
  supabaseAdmin: any,
  userId: string,
  email: string | undefined,
  reason: string,
  details: string,
  gameSlug: string
) {
  console.error(`🚨 BANNISSEMENT DE L'UTILISATEUR [${userId}] | Raison: ${reason} | Détails: ${details}`);

  // 1. Inscription dans la table banned_users
  await supabaseAdmin
    .from('banned_users')
    .upsert({
      user_id: userId,
      email: email || null,
      reason: reason,
      details: details,
      game_slug: gameSlug,
      is_active: true,
      banned_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  // 2. Révocation immédiate dans Supabase Auth (bloque son token et empêche de se reconnecter)
  try {
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: '876000h' // 100 ans
    });
  } catch (authErr: any) {
    console.error("Erreur ban auth:", authErr.message);
  }
}

// --- SERVEUR EDGE FUNCTION ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 102400) {
      return new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // A. Validation et extraction propre du jeton
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header provided" }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    // B. Vérification de l'utilisateur
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ 
        error: "Invalid token", 
        message: authError?.message || "User session invalid or expired" 
      }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 🛑 C. VÉRIFICATION IMMÉDIATE : LE JOUEUR EST-IL DÉJÀ BANNI ?
    const { data: banRecord } = await supabaseAdmin
      .from('banned_users')
      .select('reason, details')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (banRecord) {
      console.warn(`🛑 Accès refusé pour l'utilisateur banni [${user.id}]`);
      return new Response(JSON.stringify({ 
        error: "Account Banned", 
        reason: `Ce compte est suspendu. Motif : ${banRecord.reason}` 
      }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // D. Limiteur de fréquence d'appels (Rate Limiting)
    const now = Date.now();
    const lastUserSync = userLastSyncMap.get(user.id) || 0;
    if (now - lastUserSync < MIN_SYNC_INTERVAL_MS) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait." }), { 
        status: 429, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // E. Extraction du contenu de la requête
    const { game_slug, new_data } = await req.json();
    if (!game_slug || !new_data) {
      return new Response(JSON.stringify({ error: "Missing payload" }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 🚨 F. VÉRIFICATION DU GAME SLUG (BAN SI INVALIDE)
    const { data: ruleRow } = await supabaseAdmin
      .from('game_rules')
      .select('rules')
      .eq('game_slug', game_slug)
      .maybeSingle();

    if (!ruleRow) {
      await banUser(
        supabaseAdmin,
        user.id,
        user.email,
        "GAME_SLUG_INVALIDE",
        `Tentative d'accès sur le jeu non répertorié : "${game_slug}"`,
        game_slug
      );

      return new Response(JSON.stringify({ 
        error: "Forbidden", 
        reason: "Jeu non autorisé. Votre compte a été suspendu pour tentative d'intrusion." 
      }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 🚨 G. VÉRIFICATION ANTI-TRICHE (BAN SI RÈGLE VIOLÉE)
    if (ruleRow && ruleRow.rules && Array.isArray(ruleRow.rules)) {
      const check = validateDynamicRules(ruleRow.rules, new_data);
      if (!check.valid) {
        await banUser(
          supabaseAdmin,
          user.id,
          user.email,
          "TRICHE",
          check.reason || "Modification anormale des valeurs du jeu",
          game_slug
        );

        return new Response(JSON.stringify({ 
          error: "Validation failed", 
          reason: "Triche détectée. Votre compte a été suspendu." 
        }), { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    const newTs = getSavedAt(new_data);

    // H. Récupération de l'ancienne sauvegarde
    const { data: oldRow } = await supabaseAdmin
      .from('user_game_data')
      .select('data')
      .eq('user_id', user.id)
      .eq('game_slug', game_slug)
      .maybeSingle();

    const oldData = oldRow?.data || null;
    const oldTs = getSavedAt(oldData);

    if (oldTs !== 0 && newTs <= oldTs) {
      return new Response(JSON.stringify({ status: "ignored", reason: "old_or_same_timestamp" }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // I. Insertion / Mise à jour dans la BDD
    const { error: upsertError } = await supabaseAdmin
      .from('user_game_data')
      .upsert({
        user_id: user.id,
        game_slug: game_slug,
        data: new_data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,game_slug' });

    if (upsertError) throw upsertError;

    userLastSyncMap.set(user.id, now);

    return new Response(JSON.stringify({ status: "success" }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
    
  } catch (err: any) {
    console.error("Crash Secure Sync:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
