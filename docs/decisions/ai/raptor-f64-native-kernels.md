<!-- SPDX-License-Identifier: Apache-2.0 -->
# Kernels vectoriels RAPTOR en float64

Le cœur Rust `aphrody-rag-core::vectors_f64` possède la normalisation L2,
le produit matriciel des embeddings, les moyennes et les centres sphériques.
Le binding `aphrody-rust` expose ces opérations par buffers little-endian
float64. Le calcul libère le GIL ; les sorties `bytearray` sont vues comme
arrays NumPy modifiables sans recréer des objets Python par élément.

Le dénominateur de normalisation garde le clamp `1e-12`, les vecteurs nuls et
la propagation NaN. Un centre vide conserve sa valeur précédente ; une
moyenne nulle reste nulle. Les prototypes Psi gardent la moyenne float64.
Les adaptateurs valident forme, dimension et longueur du buffer avant calcul.

`ndarray 0.17.2`, déjà déclaré au workspace, fournit une interface sûre pour
le backend matriciel. Sa [documentation officielle](https://docs.rs/ndarray/0.17.2/ndarray/struct.ArrayBase.html#method.dot)
décrit le backend `matrixmultiply` pour float32/float64 sans BLAS externe.
Le `gemm 0.19` configuré au workspace n'est pas retenu ici : son API brute
demande des appels unsafe, tandis que ce cœur interdit unsafe et conserve un
check WASM. Aucun BLAS système n'est ajouté à la recette de wheel.

Le produit de deux batches identiques utilise des tuiles triangulaires puis
reflète le résultat. Une API contiguë évite les copies vers des matrices
possédées. Les tests couvrent aussi une frontière de tuile à 257 lignes.

La recette Python embarque seulement les trois modules canoniques nécessaires
depuis une révision Git fixée. `tools/packaging/pin_rag_source.py` (not in repo) lit les bytes
commités, ajoute les déclarations de module du wrapper et produit une archive
déterministe avec hashes. Les modules core sont inchangés dans cette projection.
Le backend valide l'allowlist avant toute écriture. Il ne lit aucun checkout
voisin lors de l'installation.

La qualification du 2026-10-01 prouve la parité numérique sur les fixtures,
les buckets Psi bornés, l'ordre existant des paires testé, les installations
isolées, les smokes natifs et la reproductibilité byte pour byte des wheels.
Elle ne prouve pas la parité performance : sur les trois matrices mesurées
avec un thread BLAS, le chemin natif reste environ 2,1 à 3,9 fois plus lent.
Ces mesures incluent le passage des buffers et restent sensibles à la charge
du poste. Le gate performance demeure ouvert.

Le check WASM sans `oxc` passe. Le check Windows MSVC standard échoue sur
`ml64.exe` absent pour BLAKE3. Le check avec la feature `blake3/pure` passe ;
cela ne qualifie pas le chemin d'assemblage MSVC ni une wheel Windows.

La propriété globale des calculs RAG demeure ouverte : tri/argmax Psi,
raffinement euclidien des clusters, heuristiques AHC et sélection GMM/UMAP
restent à auditer et migrer ou qualifier. Les comparaisons NumPy restent dans
les tests comme référence, pas comme fallback d'exécution des kernels migrés.
