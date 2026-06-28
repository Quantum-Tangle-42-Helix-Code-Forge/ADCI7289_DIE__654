// validators.ts

// Type pour le résultat de la validation
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Constantes globales de triche
const MAX_BANANES_PER_GAME = 50; 

/**
 * Logique pour ton jeu actuel (ex: tetris3)
 */
export function validate_tetris3(oldData: any, newData: any): ValidationResult {
  
  // 1. Vérifications communes (XP et Bananes)
  // On s'assure que l'XP est cohérent avec le nombre de bananes
  if (Number(newData.total_xp) !== Number(newData.bananes) * 100) {
    return { valid: false, reason: "Inconsistent XP/Bananas ratio" };
  }

  // On s'assure que le nombre de bananes ne dépasse pas le nombre de parties jouées * max possible
  const maxPossibleBananas = MAX_BANANES_PER_GAME * (Number(newData.nbr_games_finished) || 1);
  if (Number(newData.bananes) > maxPossibleBananas) {
    return { valid: false, reason: "Bananas count exceeds game limit" };
  }

  // 2. Vérification si une ancienne sauvegarde existe (comparaison temporelle)
  if (oldData && oldData.saved_at) {
    const newTs = Number(newData.saved_at) || 0;
    const oldTs = Number(oldData.saved_at) || 0;

    if (newTs <= oldTs) {
      return { valid: false, reason: "Attempting to overwrite with older or same data" };
    }
  }

  return { valid: true };
}

/**
 * Dictionnaire qui lie le game_slug à sa fonction de validation
 * C'est ici que tu ajoutes tes nouveaux jeux sans toucher au serveur principal.
 */
export const gameValidators: Record<string, (old: any, neu: any) => ValidationResult> = {
  "tetris3": validate_tetris3,
  // "mario": validate_mario, <- Ajouter ici plus tard
};
