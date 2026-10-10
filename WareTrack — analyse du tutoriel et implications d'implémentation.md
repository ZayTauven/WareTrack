# WareTrack — analyse du tutoriel et implications d'implémentation

Oct 9, 2026 · @Zay

Le tutoriel « Claude Opus 5.5 Built a 3D Warehouse App That Looks Like a Game » : https://youtu.be/QtvvVMICqqE (chaîne o0o0o0o) enseigne surtout une méthode, pas une application. Ses cinq prompts suffisent pour une démo soignée, pas pour un produit en production.

## Ce que la vidéo enseigne vraiment

L'application WareTrack sert d'accroche. La vraie leçon tient en trois idées :

1. **Les données d'abord, la vue ensuite.** La scène 3D n'est qu'une autre façon de lire un modèle classique : sites, quais, camions, chariots élévateurs, stock, expéditions. On peut remplacer l'interface sans toucher aux données.
2. **Une structure de prompt en cinq parties**, répétée à chaque prompt : contexte, objectif, contraintes, livrable attendu, vérification.
3. **De petites étapes protégées.** Chaque prompt réduit le périmètre (« pas encore d'UI »), protège le travail fini (« ne modifie pas les fichiers de données ») et se termine par une vérification. On commit après chaque étape qui fonctionne.

L'architecture produite tient en quatre couches : les données typées alimentent un store Zustand, qui sert à la fois la scène 3D (affichage seul) et l'interface (panneau latéral, KPI, filtres).

&#91;embedded content: architecture WareTrack · 4 couches\]

Les vues ne lisent que le store ; remplacer la simulation par un WebSocket ne touche ni la scène ni l'interface.

## Implications d'implémentation, étape par étape

Chaque étape cache au moins une lacune que la vidéo ne mentionne pas.

### Étape 0 — image de concept

Bonne astuce. Claude ne génère pas d'images, mais une maquette HTML/SVG remplit le même rôle.

### Prompt 1 — modèle de données

- **Champs spatiaux manquants.** Le prompt 2 demande un positionnement « à partir des données », mais le prompt 1 ne demande aucune coordonnée. Il faut des positions, dimensions et rotations pour quais et rayonnages, plus un `Site.origin` pour séparer les sites. Sinon Claude invente les positions dans la scène ou doit refaire les données.
- **Des données de démo, pas un backend.** Sur votre stack, la source de vérité serait des modèles Django avec DRF. Les types TS seraient générés depuis le schéma OpenAPI pour éviter toute divergence.
- Petite coquille dans la fiche : `Inventorytem`.

### Prompt 2 — scène 3D

- **Next.js.** Le canvas R3F doit être un composant client chargé via `dynamic(..., { ssr: false })`.
- **Un vrai isométrique demande une caméra orthographique.** Une caméra perspective inclinée n'en donne que l'apparence. Les contrôles de caméra de drei gèrent le pan, le zoom et les limites.
- **Les ombres douces coûtent cher.** C'est la première chose à couper sur les machines modestes.

### Prompt 3 — clic pour inspecter

- **Les mises à jour toutes les 2 secondes sont simulées.** En production, elles viendraient d'un WebSocket (Django Channels) ou de Server-Sent Events, alimentant le même store. Le design centré sur le store rend ce remplacement simple.
- **« Pas de logique métier dans la scène » est la règle la plus précieuse.** Les composants de la scène lisent le store via des sélecteurs étroits. Un composant abonné à tout le store re-rend toute la scène toutes les 2 secondes : c'est le problème de performance le plus courant ici.

### Prompt 4 — KPI, sites et filtres

- **« Tout calculé depuis le store »** convient pour une démo. À l'échelle réelle, avec des milliers d'expéditions, le backend calcule les KPI et le store ne garde que les résultats.
- **La transition de caméra entre sites** est simple avec drei, à condition que chaque site ait des coordonnées connues (même lacune qu'au prompt 1).

### Prompt 5 — revue et finition

- **L'instancing entre en conflit avec le clic pour inspecter.** Un clic sur un objet instancié renvoie un `instanceId`, pas un objet, et surligner une seule instance demande plus de travail. Avec des centaines d'objets, prévoyez l'instancing dès le prompt 2.
- **L'IA ne peut pas vérifier les 60 FPS.** Claude peut lancer le build et le type check, mais pas mesurer la fluidité sans navigateur. Vérifiez vous-même, par exemple avec `r3f-perf`.

## Ce qu'un déploiement réel exigerait encore

- **Authentification et rôles.** Absents de la vidéo.
- **Persistance et historique** des changements d'état.
- **Infrastructure temps réel** à la place des mises à jour simulées.
- **Une vue 2D de secours.** Un canvas 3D n'est pas accessible ; il faut une vue tableau ou liste, peu coûteuse grâce au design « données d'abord ».
- **Support mobile et appareils modestes.** R3F fonctionne dans Expo via `expo-gl`, mais drei n'y est que partiellement supporté. Les scènes lourdes sont risquées sur Android milieu de gamme : prévoyez une vue mobile simplifiée.
- **Des tests**, en particulier sur le calcul des KPI.

## Évaluation globale

Les cinq prompts mènent de façon réaliste à une démo soignée en un ou deux jours d'itération. Ce n'est pas un chemin vers la production, et la vidéo ne le prétend pas.

Ce qui se transpose le mieux, c'est la méthode : modèle de données d'abord, structure de prompt en cinq parties, protection du travail terminé. Elle s'applique à n'importe quel projet. Dahoo, par exemple, pourrait avoir une vue d'occupation des immeubles ou des logements selon le même principe : la 3D n'est qu'une vue des données.

**Prochaine étape possible :** réécrire les cinq prompts pour la stack Django + DRF + Next.js, avec les champs spatiaux et le chemin temps réel intégrés dès le départ.
