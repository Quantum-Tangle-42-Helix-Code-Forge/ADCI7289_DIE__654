Voici le fichier de référence complet et exhaustif, rédigé sous forme de
Manifeste d'Architecture et Guide de Développement (Prompt Master).

Vous pouvez copier ce texte, le sauvegarder dans un fichier nommé
ARCHITECTURE_GUIDELINES.md à la racine de votre projet, ou le coller au début de
n'importe quelle future discussion avec une IA pour qu'elle respecte à 100 % la
philosophie, la sécurité et la vitesse de votre plateforme aks6.ink.

📖 CHARTE TECHNIQUE ET DIRECTIVES DE DÉVELOPPEMENT — AKS6.INK

Ce document constitue la référence absolue pour la maintenance, la refonte ou la
création de toute nouvelle page sur le site aks6.ink. Toute IA ou développeur
travaillant sur ce projet doit impérativement respecter l'ensemble des règles
ci-dessous sans déroger aux principes de sécurité et d'optimisation établis.

1. ARCHITECTURE GLOBALE ET STACK TECHNIQUE

  - Front-end : HTML5 sémantique, CSS moderne vanille (main.css), JavaScript ES6
    natif avec modules (<script type="module">). Pas de framework lourd (pas de
    React, Vue ou Angular).
  - Base de données & Auth : Supabase (@supabase/supabase-js).
  - Hébergement des fichiers d'installation (Builds) : GitHub Releases. Les
    installateurs (.exe, .apk, .dmg, .AppImage de 1 Mo à 2 Go) sont attachés à
    des releases GitHub dédiées par jeu (game-${slug}). Aucun fichier binaire
    lourd ne transite par la bande passante de Supabase.
  - Images de couverture : Hébergées sur Cloudinary avec transformation
    automatique à la volée.
  - Jeux WebGL : Hébergés dans des dossiers locaux dédiés (./games/${slug}/).
  - CDN & Proxy : Cloudflare (Cache, DNS, SSL).

2. SÉCURITÉ ABSOLUE : IMMUNITÉ CONTRE LES FAILLES XSS

Toute donnée provenant de Supabase, d'une URL, d'un formulaire ou du profil
utilisateur est considérée comme potentiellement malveillante.

❌ INTERDICTIONS FORMELLES

1.  Ne jamais injecter de variables brutes dans innerHTML : Interdiction
    d'écrire ${game.title} ou ${user.display_name} directement dans du HTML.
2.  Ne jamais faire d'injections dans les attributs onclick en chaîne de
    caractères : Interdiction d'écrire onclick="supprimer('${item.id}')".
    Utiliser systématiquement data-id="${item.id}" avec
    document.querySelectorAll() et addEventListener.
3.  Ne jamais faire confiance aux URLs externes : Interdiction d'affecter une
    URL brute à href ou src. Risque critique de payload javascript:....

OBLIGATIONS TECHNIQUES

Tout fichier manipulant des données dynamiques doit inclure et utiliser ces
trois fonctions utilitaires :

// 1. Neutralise les injections de balises HTML (<script>, <img>, etc.)
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 2. Bloque strictement les protocoles malveillants (javascript:, data:, vbscript:)
function safeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('./') || trimmed.startsWith('/')) {
        return trimmed;
    }
    return null;
}

// 3. Valide les médias et images autorisés
function safeMediaUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('./')) ? url : '';
}

  - Textes dynamiques : Privilégier systématiquement element.innerText = ... ou
    element.textContent = ... plutôt que innerHTML.
  - Rendu média : Préférer la création native d'éléments DOM
    (document.createElement('img')) et le remplacement propre
    (container.replaceChildren(img)).
  - Sécurité côté serveur : La sécurité des opérations sensibles (suppression de
    commentaires, ajout en bibliothèque, suppression de jeux) repose sur les
    politiques RLS (Row Level Security) de Supabase (auth.uid() = user_id), et
    non sur des contrôles côté client.

3. PERFORMANCE ET CORE WEB VITALS (SCORE LIGHTHOUSE 95 - 100)

3.1. Élimination totale du CLS (Cumulative Layout Shift = 0.00)

Le CLS se produit quand des éléments sautent à l'écran pendant le chargement
(notamment le footer repoussé vers le bas).

  - Interdiction du masquage complet par display: none : Ne jamais masquer
    l'interface complète derrière un loader pour la faire apparaître d'un coup.
  - Réservation d'espace par Skeleton Screens : Tout conteneur dynamique
    (#game-grid, #library-container) doit afficher dès son HTML initial des
    cartes squelettes (<div class="skeleton-card">) avec des hauteurs réservées.
  - Dimensions fixes sur les images : Toutes les balises <img> doivent
    obligatoirement comporter width="315" height="200" (ou équivalent) et la
    classe CSS associée doit comporter aspect-ratio: 16 / 10; object-fit:
    cover;.
  - Hauteur minimale de sécurité : Appliquer min-height sur les conteneurs
    principaux (.account_layout, .game_grid_widget).

3.2. Optimisation chirurgicale du LCP (Largest Contentful Paint)

L'élément le plus volumineux de la page (généralement la première carte de jeu
ou le hero banner) doit être priorisé selon la règle des 3 tiers :

// Règle d'or pour les boucles de cartes (index 0 = LCP officiel)
let loadingAttributes = '';
if (index === 0) {
    // 1ère image (LCP) : priorité maximale, INTERDICTION de loading="lazy"
    loadingAttributes = 'fetchpriority="high"';
} else if (index < 3) {
    // Images 1 et 2 visibles au-dessus de la ligne de flottaison : chargement normal
    loadingAttributes = '';
} else {
    // Images sous la ligne de flottaison : lazy loading activé
    loadingAttributes = 'loading="lazy"';
}

  - Dimensionnement Cloudinary à la volée : Ne jamais charger une image brute
    de 1000px dans une vignette de 170px.

function optimizeCloudinary(url, width = 320) {
    if (!url || typeof url !== 'string') return '';
    if (!url.includes('cloudinary.com') || url.includes('/f_auto')) return url;
    return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`);
}
// Utiliser w_320 pour les vignettes et w_1000 pour les bannières Hero

3.3. Détection de session instantanée (0 milliseconde)

Ne jamais faire attendre les requêtes de données publiques derrière un appel
réseau supabase.auth.getUser().

// Détection instantanée via le cache local du navigateur
const hasLocalToken = Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));

let isAdmin = false;
let currentUser = null;

if (hasLocalToken) {
    // Seul un utilisateur authentifié déclenche la vérification réseau
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        currentUser = user;
        const { data: adminData } = await supabase
            .from('admins')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();
        isAdmin = (adminData !== null);
    }
}

// Les requêtes de jeux partent directement avec is_test: isAdmin

3.4. Gestion des typographies (Fonts)

  - Pas d'appels bloquants vers Google Fonts : Ne plus utiliser de balises
    bloquantes fonts.googleapis.com (gain : ~900 ms).
  - Auto-hébergement en .woff2 : Héberger les polices en local dans /fonts/ au
    format .woff2 uniquement (poids plume).
  - Préchargement dans le <head> : Toujours précharger la graisse normale dès le
    haut de la page :
    <link rel="preload" href="fonts/nom-de-la-police-regular.woff2" as="font" type="font/woff2" crossorigin>
  - Déclaration CSS : Toujours utiliser font-display: swap; dans @font-face pour
    garantir que le texte reste visible immédiatement.

3.5. Règles de mise en cache Cloudflare

  - Fichiers HTML : JAMAIS de cache navigateur long (Browser Cache TTL). Laisser
    sur « Respect Existing Headers » ou no-cache pour permettre les mises à jour
    instantanées du site.
  - Fichiers statiques (.css, .js, .woff2, images) : Appliquer une règle de
    cache Cloudflare avec un Browser TTL de 7 jours ou 1 mois.
  - Cache-busting : Si un fichier CSS/JS critique est modifié, incrémenter
    manuellement son paramètre de version (main.css?v=1.1). Ne jamais mettre en
    place de GitHub Actions qui re-committent automatiquement dans Git.

4. RÈGLES DE CONCEPTION DES MODULES SPÉCIFIQUES

4.1. Fichiers téléchargeables & Stores (GitHub Releases)

  - Les builds d'installation pour chaque plateforme sont stockés sur GitHub
    Releases avec le tag game-${slug}.
  - Dans game.html, les cartes de téléchargement (Windows, Linux, macOS,
    Android) ne sont générées que si has_[os] === true et que l'URL est validée
    par safeUrl().
  - Les boutons de stores externes (Steam, Play Store, App Store, Itch.io)
    utilisent textContent et s'ouvrent dans un nouvel onglet avec rel="noopener
    noreferrer".

4.2. Espace Commentaires (game_comments)

  - Limite stricte de 500 caractères gérée par un compteur interactif, un
    maxlength="500" en HTML et une contrainte CHECK en SQL.
  - Affichage du nom d'auteur sécurisé par escapeHtml() et date formatée en
    français (fr-FR).
  - Le bouton de suppression d'un commentaire n'apparaît que si currentUser.id
    === comment.user_id || isAdmin. La sécurité est validée côté serveur par les
    politiques RLS.

4.3. Bibliothèque utilisateur (user_library)

  - Le bouton d'ajout/retrait sur game.html bascule en direct (➕ Ajouter / ✅
    Dans ma bibliothèque).
  - Sur user_account.html, les jeux sont triés pour respecter l'ordre
    chronologique d'ajout (gameMap).
  - La zone de bibliothèque sur user_account.html commence par des cartes
    squelettes pour bloquer le CLS pendant la requête Supabase.

5. SQUELETTE MODÈLE D'UNE NOUVELLE PAGE (TEMPLATE OFFICIEL)

Toute nouvelle page créée sur le site doit reproduire cette structure :

<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Description soignée pour le SEO">
    
    <!-- Préchargement de la police locale -->
    <link rel="preload" href="fonts/votre-police-regular.woff2" as="font" type="font/woff2" crossorigin>
    
    <link rel="stylesheet" href="main.css">
    <title>aks6.ink - Titre de la page</title>
    
    <!-- Supabase JS différé -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4" defer></script>
</head>
<body>
    <div class="header_spacer"></div>
    <header class="primary_header">
        <a class="header_logo" href="index.html">aks6.ink</a>
        <div class="header_buttons">
            <a class="header_button" href="browse.html">Parcourir</a>
        </div>
        <form action="browse.html" method="GET" class="game_search" role="search">
            <input type="text" name="q" class="search_input" placeholder="Rechercher titre, genre..." aria-label="Rechercher des jeux">
        </form>
        <div class="user_panel_widget" id="user-panel">
            <a href="index.html" class="panel_button">Accueil</a>
        </div>
    </header>

    <main class="inner_column">
        <!-- Contenu avec conteneur réservé pour éviter le CLS -->
        <div class="base_widget" style="min-height: 400px;">
            <h1 id="page-title">Titre</h1>
            <div id="content-area">
                <!-- Squelettes de réservation si chargement asynchrone -->
                <div class="skeleton-card"></div>
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="footer_copy">© 2026 <strong>Sekhmetis</strong> - Tous droits réservés.</div>
        <div class="footer_links">
            <a href="legal_pages.html#confidentialite">Politique de Confidentialité</a>
            <a href="legal_pages.html#apropos">À Propos</a>
            <a href="legal_pages.html#contact">Contact</a>
        </div>
        <a href="#" onclick="if(window.googlefc) googlefc.showRevocationMessage(); return false;">Gestion des cookies</a>
    </footer>

    <script type="module">
        import { supabase } from './js/config.js';

        // Utilitaires de sécurité obligatoires
        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }
        function safeUrl(url) {
            if (!url || typeof url !== 'string') return null;
            const t = url.trim();
            return (t.startsWith('https://') || t.startsWith('http://') || t.startsWith('./') || t.startsWith('/')) ? t : null;
        }

        async function init() {
            // Détection session 0 ms
            const hasToken = Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
            // Logique de la page...
        }

        window.addEventListener('DOMContentLoaded', init);
    </script>
</body>
</html>

6. CHECKLIST DE VALIDATION AVANT TOUTE MISE EN LIGNE

Avant de valider une page ou un commit, vérifier les points suivants :

- [ ] Zéro fuite XSS : Aucune concaténation de texte brut dans innerHTML ; usage
  strict de escapeHtml() ou textContent.
- [ ] Zéro lien malveillant : Toutes les URLs dynamiques passent par safeUrl().
- [ ] Attributs d'images : La 1ère image a fetchpriority="high", les suivantes
  loading="lazy", et toutes ont width et height.
- [ ] Zéro CLS : Aucun conteneur important n'est masqué par display: none
  pendant les requêtes ; les squelettes de chargement sont présents.
- [ ] Cloudinary optimisé : Les images utilisent f_auto,q_auto,w_320 (ou 1000
  pour les bannières).
- [ ] Absence de Google Fonts : La police est locale (.woff2) et préchargée dans
  le <head>.
- [ ] Pas de cache navigateur sur le HTML : Les fichiers .html ne sont pas mis
  en cache longue durée sur Cloudflare.
