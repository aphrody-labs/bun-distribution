//! Découverte **autoritaire** des fonctions via la table `.pdata` (exception
//! unwind x86-64), et mesure du désalignement de l'index Ghidra.
//!
//! ## Pourquoi
//!
//! L'index `aphrody-nie-index.json` fournit ~60 000 adresses `FUN_<hex>` supposées être
//! des débuts de fonction. La vérification byte-à-byte contre `.pdata` (la table
//! d'unwind générée par le compilateur, vérité terrain incontestable) montre que
//! ces adresses sont **massivement désalignées** : ~96 % ne sont pas des débuts
//! de fonction réels (84 % tombent *strictement à l'intérieur* d'un corps de
//! fonction `.pdata`), et l'ensemble est artificiellement aligné sur 16 octets à
//! 99 %. L'index reste exploitable comme **graphe de métadonnées** (chaînes,
//! namespaces, relations d'appel) mais ses **adresses ne sont pas fiables**.
//!
//! `.pdata` donne la liste réelle : chaque `RUNTIME_FUNCTION` (12 octets :
//! `begin_rva`, `end_rva`, `unwind_rva`) décrit une région de code avec ses
//! bornes. Certaines entrées sont des **fragments chaînés** (`UNW_FLAG_CHAININFO`)
//! — des morceaux d'une fonction plus grande, pas des débuts. On les écarte par
//! lecture du `UNWIND_INFO` ; les entrées **racines** restantes sont les vraies
//! fonctions.
//!
//! ## Limite (honnêteté)
//!
//! `.pdata` ne couvre que les fonctions **avec** information d'unwind (cadre de
//! pile). Les fonctions feuilles triviales sans cadre n'y figurent pas : la liste
//! `.pdata` est un plancher autoritaire, pas un plafond.

#[cfg(feature = "host")]
use anyhow::{Context, Result};
#[cfg(feature = "host")]
use aphrody_nie_index::{Db, rusqlite};
#[cfg(feature = "host")]
use goblin::pe::PE;
#[cfg(feature = "host")]
use tracing::info;

// Generic byte parser lives in the single RE core (`aphrody_re::pdata`).
pub use aphrody_re::pdata::*;

/// Statistiques de la découverte `.pdata`.
#[derive(Debug, Clone, Copy, Default)]
pub struct PdataStats {
    /// Entrées `RUNTIME_FUNCTION` totales.
    pub entries: usize,
    /// Fragments chaînés écartés (`UNW_FLAG_CHAININFO`).
    pub chained_fragments: usize,
    /// Fonctions racines réelles retenues.
    pub roots: usize,
    /// Racines insérées en base.
    pub inserted: usize,
    /// Racines dont le début coïncide avec une adresse de l'index Ghidra.
    pub overlap_ghidra: usize,
    /// Adresses Ghidra tombant *strictement à l'intérieur* d'un corps `.pdata`
    /// (preuve de désalignement : ce ne sont pas des débuts de fonction).
    pub ghidra_inside_body: usize,
    /// Fonctions Ghidra totales (dans `.text`).
    pub ghidra_total: usize,
}

/// Découvre les fonctions racines via `.pdata`, les stocke dans `pdata_func`, et
/// mesure le désalignement de l'index Ghidra (`function`) déjà chargé.
#[cfg(feature = "host")]
pub fn discover_into(
    db: &mut Db,
    binary_id: i64,
    exe_path: &std::path::Path,
) -> Result<PdataStats> {
    let bytes =
        std::fs::read(exe_path).with_context(|| format!("lecture {}", exe_path.display()))?;
    let roots = parse_roots(&bytes)?;

    let total_entries = {
        // recompte les entrées brutes pour le rapport
        let pe = PE::parse(&bytes).context("parse PE")?;
        let pdata = pe.sections.iter().find(|s| s.name().is_ok_and(|n| n.starts_with(".pdata")));
        pdata.map_or(0, |s| (s.virtual_size.min(s.size_of_raw_data)) as usize / 12)
    };

    // Insertion des racines.
    let inserted = {
        let tx = db.conn_mut().transaction()?;
        let mut n = 0usize;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO pdata_func(binary_id, start, end) VALUES(?1,?2,?3)",
            )?;
            for r in &roots {
                n += stmt.execute(rusqlite::params![binary_id, r.start as i64, r.end as i64])?;
            }
        }
        tx.commit()?;
        n
    };

    // Mesure du désalignement Ghidra.
    let ghidra: Vec<i64> = {
        let mut stmt =
            db.conn().prepare("SELECT vaddr FROM function WHERE binary_id=?1 ORDER BY vaddr")?;
        stmt.query_map([binary_id], |r| r.get::<_, i64>(0))?
            .collect::<std::result::Result<_, _>>()?
    };
    // Bornes des racines pour test d'inclusion (tri par start déjà fait).
    let starts: Vec<u64> = roots.iter().map(|r| r.start).collect();
    let root_starts: std::collections::HashSet<u64> = starts.iter().copied().collect();

    // .text bounds via parse (pour ne compter que les fonctions de .text).
    let (tva, tend) = {
        let pe = PE::parse(&bytes).context("parse PE")?;
        let t = pe
            .sections
            .iter()
            .find(|s| s.name().is_ok_and(|n| n.starts_with(".text")))
            .context(".text introuvable")?;
        let va = pe.image_base + u64::from(t.virtual_address);
        (va, va + u64::from(t.virtual_size.min(t.size_of_raw_data)))
    };

    let mut overlap = 0usize;
    let mut inside = 0usize;
    let mut gtotal = 0usize;
    for &g in &ghidra {
        let g = g as u64;
        if g < tva || g >= tend {
            continue;
        }
        gtotal += 1;
        if root_starts.contains(&g) {
            overlap += 1;
            continue;
        }
        // Recherche de la racine dont le corps contient g.
        let idx = starts.partition_point(|&s| s <= g);
        if idx > 0 {
            let r = roots[idx - 1];
            if r.start < g && g < r.end {
                inside += 1;
            }
        }
    }

    let stats = PdataStats {
        entries: total_entries,
        chained_fragments: total_entries.saturating_sub(roots.len()),
        roots: roots.len(),
        inserted,
        overlap_ghidra: overlap,
        ghidra_inside_body: inside,
        ghidra_total: gtotal,
    };
    info!(
        "pdata: {} racines insérées; Ghidra {}/{} alignées, {} à l'intérieur de corps",
        stats.inserted, stats.overlap_ghidra, stats.ghidra_total, stats.ghidra_inside_body
    );
    Ok(stats)
}

/// Statistiques de la refondation `.pdata`.
#[derive(Debug, Clone, Copy, Default)]
pub struct RebuildStats {
    /// Fonctions racines insérées comme nœuds.
    pub roots: usize,
    /// Références de chaînes ré-ancrées sur la fonction contenante.
    pub str_refs_moved: usize,
    /// Constantes ré-ancrées.
    pub consts_moved: usize,
    /// Arêtes `ce` Ghidra repliées sur les racines contenantes.
    pub ce_edges_mapped: usize,
    /// Classes RTTI copiées vers la cible.
    pub rtti_copied: usize,
    /// Métadonnées Ghidra sans fonction racine contenante (perdues).
    pub unmapped: usize,
}

/// Reconstruit la carte des fonctions sur la **vérité terrain `.pdata`** : insère
/// les 50 674 fonctions racines comme nœuds dans `dst_bin`, puis **ré-ancre** les
/// métadonnées de l'index Ghidra (`src_bin`) par *inclusion* — chaque nœud Ghidra
/// à l'adresse `a` (massivement désaligné, souvent au milieu d'un corps) voit ses
/// chaînes / constantes / arêtes transférées à la fonction racine réelle qui
/// contient `a`. Le résultat : un graphe à adresses correctes sur lequel `disasm`
/// (vrais débuts) et `propagate` redeviennent physiquement valides.
#[cfg(feature = "host")]
pub fn rebuild_from_pdata(
    db: &mut Db,
    src_bin: i64,
    dst_bin: i64,
    exe_path: &std::path::Path,
) -> Result<RebuildStats> {
    let bytes =
        std::fs::read(exe_path).with_context(|| format!("lecture {}", exe_path.display()))?;
    let roots = parse_roots(&bytes)?;
    let starts: Vec<u64> = roots.iter().map(|r| r.start).collect();
    let find_root = |a: u64| -> Option<u64> { root_containing(&starts, &roots, a) };

    // --- Lectures de la source (avant d'ouvrir la transaction d'écriture) ------
    let str_rows: Vec<(u64, String)> = {
        let mut q = db.conn().prepare(
            "SELECT f.vaddr, s.value FROM func_str_ref s JOIN function f ON f.id=s.function_id WHERE f.binary_id=?1",
        )?;
        q.query_map([src_bin], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<_, _>>()?
    };
    let const_rows: Vec<(u64, i64)> = {
        let mut q = db.conn().prepare(
            "SELECT f.vaddr, c.value FROM func_const c JOIN function f ON f.id=c.function_id WHERE f.binary_id=?1",
        )?;
        q.query_map([src_bin], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)?)))?
            .collect::<std::result::Result<_, _>>()?
    };
    let ce_rows: Vec<(u64, u64)> = {
        let mut q = db
            .conn()
            .prepare("SELECT from_addr, to_addr FROM xref WHERE binary_id=?1 AND kind='call'")?;
        q.query_map([src_bin], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)))?
            .collect::<std::result::Result<_, _>>()?
    };
    let rtti_rows: Vec<(String, Option<String>, Option<String>)> = {
        let mut q = db
            .conn()
            .prepare("SELECT name, namespace, mangled FROM rtti_class WHERE binary_id=?1")?;
        q.query_map([src_bin], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<std::result::Result<_, _>>()?
    };

    let mut stats = RebuildStats { roots: roots.len(), ..Default::default() };
    let tx = db.conn_mut().transaction()?;

    // --- 1. Insère les fonctions racines (vraies entrées + tailles) -----------
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR IGNORE INTO function(binary_id, vaddr, size, name_source, subsystem, confidence)
             VALUES(?1,?2,?3,'pdata','standalone',0.0)",
        )?;
        for r in &roots {
            ins.execute(rusqlite::params![dst_bin, r.start as i64, (r.end - r.start) as i64])?;
        }
    }
    // Carte vaddr → function_id pour la cible.
    let mut root_fid: hashbrown::HashMap<u64, i64> = hashbrown::HashMap::with_capacity(roots.len());
    {
        let mut q = tx.prepare("SELECT vaddr, id FROM function WHERE binary_id=?1")?;
        let rows =
            q.query_map([dst_bin], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (v, id) = row?;
            root_fid.insert(v, id);
        }
    }

    // --- 2. Ré-ancre les chaînes par inclusion --------------------------------
    {
        let mut ins = tx.prepare_cached(
            "INSERT INTO func_str_ref(binary_id, function_id, value) VALUES(?1,?2,?3)",
        )?;
        for (va, val) in &str_rows {
            match find_root(*va).and_then(|s| root_fid.get(&s)) {
                Some(&fid) => {
                    ins.execute(rusqlite::params![dst_bin, fid, val])?;
                    stats.str_refs_moved += 1;
                },
                None => stats.unmapped += 1,
            }
        }
    }
    // --- 3. Ré-ancre les constantes -------------------------------------------
    {
        let mut ins =
            tx.prepare_cached("INSERT INTO func_const(function_id, value) VALUES(?1,?2)")?;
        for (va, val) in &const_rows {
            if let Some(&fid) = find_root(*va).and_then(|s| root_fid.get(&s)) {
                ins.execute(rusqlite::params![fid, val])?;
                stats.consts_moved += 1;
            }
        }
    }
    // --- 4. Replie les arêtes d'appel Ghidra sur les racines ------------------
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR IGNORE INTO xref(binary_id, from_addr, to_addr, kind) VALUES(?1,?2,?3,'call')",
        )?;
        for (from, to) in &ce_rows {
            if let (Some(rf), Some(rt)) = (find_root(*from), find_root(*to))
                && rf != rt
            {
                ins.execute(rusqlite::params![dst_bin, rf as i64, rt as i64])?;
                stats.ce_edges_mapped += 1;
            }
        }
    }
    // --- 5. Copie les classes RTTI --------------------------------------------
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR IGNORE INTO rtti_class(binary_id, name, namespace, mangled) VALUES(?1,?2,?3,?4)",
        )?;
        for (name, ns, mangled) in &rtti_rows {
            ins.execute(rusqlite::params![dst_bin, name, ns, mangled])?;
            stats.rtti_copied += 1;
        }
    }

    tx.commit()?;
    info!(
        "rebuild: {} racines, {} str ré-ancrées ({} perdues), {} consts, {} arêtes ce, {} rtti",
        stats.roots,
        stats.str_refs_moved,
        stats.unmapped,
        stats.consts_moved,
        stats.ce_edges_mapped,
        stats.rtti_copied
    );
    Ok(stats)
}

