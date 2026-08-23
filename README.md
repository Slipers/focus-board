<div align="center">

<img src="assets/icon.png" width="96" alt="Icône FocUs Board">

# FocUs Board

Tableau blanc infini, local-first, pensé pour les tablettes graphiques — remplaçant de Microsoft Whiteboard, qui ferme.

[**⬇ Télécharger pour Windows**](https://github.com/Slipers/focus-board/releases/latest/download/FocUs-Board-Setup.exe) · [Releases](https://github.com/Slipers/focus-board/releases)

</div>

## Ce que ça fait

FocUs Board est une application Windows native (Electron) : un tableau blanc à toile infinie, avec un moteur d'encre à largeur variable pilotée par la pression du stylet, pensé du premier au dernier pixel pour les tablettes graphiques. Aucun compte, aucun cloud — chaque tableau est un fichier JSON sur votre disque, sauvegardé automatiquement.

## Pourquoi pas Microsoft Whiteboard ?

Microsoft Whiteboard ferme, et l'application installée n'était qu'une coquille WebView2 pointant vers `whiteboard.microsoft.com` — rien à en garder, y compris vos tableaux si vous ne les exportez pas avant l'extinction. FocUs Board reprend l'essentiel de ce qu'on attend d'un tableau blanc, en mieux sur le point qui compte le plus pour un usage au stylet : un vrai moteur d'encre à pression, avec détection automatique du matériel et repli intelligent quand le pilote ne transmet rien.

## Fonctionnalités

- 🖊️ **Encre à pression réelle** — stylo, feutre, surligneur, crayon ; largeur variable avec attaque et sortie effilées, détection automatique d'une tablette qui ne transmet pas de vraie pression avec repli sur la vitesse
- 🧽 **Gomme au trait ou ponctuelle** — la gomme ponctuelle découpe un tracé en deux, même au milieu d'une longue ligne ; sa taille grossit avec la vitesse du geste, pour balayer large d'un coup de main
- 🔷 **Formes, notes, texte, images** — rectangle, ellipse, losange, triangle, étoile, ligne, flèche ; notes autocollantes à texte auto-ajusté ; images par glisser-déposer ou collage
- ✨ **Reconnaissance de formes** — un cercle ou un rectangle tracé à main levée devient une forme nette (désactivable)
- 🧲 **Sélection et manipulation** — rectangle ou lasso, déplacement, redimensionnement, rotation, magnétisme sur les bords et centres voisins, ordre de superposition
- 🔍 **Zoom fluide à la molette**, centré sur le curseur, et pan au clic molette maintenu ou à deux doigts
- ↩️ **Historique par patches** — annuler/rétablir sans jamais dupliquer le document entier
- 🎨 **Toile infinie** — fonds uni / quadrillage / points / lignes / isométrique, papier blanc, crème, ardoise ou noir, thème clair/sombre
- 🔴 **Pointeur laser** — trace qui s'efface toute seule, pour présenter
- 🗂️ **Bibliothèque locale** — tous vos tableaux avec vignettes, duplication, suppression
- 📤 **Exports** — PNG (fond plein ou transparent), SVG vectoriel, `.focusboard.json` réimportable
- 🔄 **Mises à jour automatiques** — détection, téléchargement et installation en un clic

## Pour commencer

1. [Téléchargez `FocUs-Board-Setup.exe`](https://github.com/Slipers/focus-board/releases/latest/download/FocUs-Board-Setup.exe) et lancez-le — aucun droit administrateur requis, désinstallation propre incluse.
2. Choisissez votre outil dans la barre flottante à gauche et dessinez.
3. Ouvrez ⚙ **Réglages** pour régler la courbe de pression, le lissage du trait et le comportement du bouton latéral du stylet à votre matériel.

Vos tableaux sont enregistrés automatiquement dans `%APPDATA%\FocUs Board\boards\` — un fichier JSON par tableau.

## Tablette graphique

Le point sur lequel l'app est le plus exigeante avec elle-même :

- **Détection automatique de la pression** — si le pilote de la tablette ne transmet aucune vraie mesure de force (mode WinTab plutôt que Windows Ink), l'app le détecte dès les premiers traits et bascule sur une épaisseur simulée par la vitesse, avec un indicateur clair dans ⚙ Réglages → Diagnostic du stylet.
- **Lissage réglable** — deux étages de filtre en cascade pendant la capture, calibrés pour couper le tremblement sans ajouter de retard par rapport à un filtre simple.
- **Stabilité réglable (0 → 1)** — une zone morte qui annule complètement les micro-mouvements sous son seuil, plutôt que de les atténuer : c'est ce qui fait ressortir des lettres nettes malgré une main qui tremble, au prix d'un léger retard du trait sur le stylet.
- **Rejet de paume**, bout gomme du stylet, bouton latéral configurable (rien / déplacer / gommer / sélectionner), inclinaison pour un effet de biseau.

## Comment ça marche

Le moteur d'encre (contour de trait à largeur variable, simplification Ramer–Douglas–Peucker, reconnaissance de formes, export SVG) est écrit sur place, sans dépendance à l'exécution. Le rendu tient sur deux canvas superposés — la scène, redessinée seulement quand elle change, et une couche vive pour le trait en cours — pour garder la latence du stylet la plus basse possible.

## Prérequis

- Windows 10/11

## Développement

```bash
npm install
npm run dev
```

### Reconstruire l'exécutable et l'installeur

```bash
npm run dist
```

Produit `release/FocUs-Board-Setup.exe` (installeur NSIS) et `release/FocUs-Board-Portable.exe` (aucune installation requise).

## Mises à jour automatiques

L'app vérifie au démarrage, puis toutes les 30 minutes, si une nouvelle version est publiée sur ce dépôt ([electron-updater](https://github.com/electron-userland/electron-builder)) et affiche une carte « Mise à jour disponible » avec un bouton **Installer** : téléchargement avec barre de progression, puis redémarrage automatique. Ne s'applique qu'à la version installée via `FocUs-Board-Setup.exe` — l'exécutable portable n'a pas d'emplacement fixe où appliquer une mise à jour en place, il ne vérifie donc rien.

**Publier une mise à jour** (depuis une machine authentifiée avec `gh auth login`, scope `repo`) :

```bash
# 1. Monter le numéro de version dans package.json, ex. "1.1.0"
# 2. Construire et publier en une commande :
GH_TOKEN=$(gh auth token) npm run release
```

`electron-builder` construit l'installeur, génère les métadonnées de mise à jour (`latest.yml`) et publie le tout comme release GitHub. Les tableaux déjà installés détectent la nouvelle version au prochain lancement.

## Licence

[MIT](LICENSE)
