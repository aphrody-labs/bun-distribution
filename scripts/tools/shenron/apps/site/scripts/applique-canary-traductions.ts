#!/usr/bin/env bun
/** Atomic execution of a reviewed translation-removal manifest. Simulation default. */
import { arretSiGel, connecte, ecrirePlanche, traductionDePlanche } from "./_databooks-base";
const args = process.argv.slice(2);
const apply = args.includes("--appliquer");
const path = args.find((a) => !a.startsWith("--"));
if (!path) throw new Error("usage: applique-canary-traductions.ts manifest.json [--appliquer]");
if (apply) arretSiGel("applique-canary-traductions");
type Entry={databook_id:number;page:number;expected_text_fr_sha256:string;action:"remove_translation"};
const manifest=await Bun.file(path).json() as {entries:Entry[]};
if (!Array.isArray(manifest.entries)||manifest.entries.length<10) throw new Error("canary incomplet (<10)");
const sql=await connecte();
const hash=(s:string)=>new Bun.CryptoHasher("sha256").update(s).digest("hex");
try {
	const checked: { entry: Entry; fr: string }[]=[];
	for(const entry of manifest.entries){
		const [row]=await sql<{p:unknown}[]>`select p from bot.db_databooks d cross join lateral jsonb_array_elements(d.pages)p where d.id=${entry.databook_id} and (p->>'number')::numeric=${entry.page}`;
		const fr=traductionDePlanche(row?.p);
		if(!fr||hash(fr)!==entry.expected_text_fr_sha256) throw new Error(`expected-before mismatch ${entry.databook_id}/${entry.page}`);
		checked.push({entry,fr});
	}
	if(!apply){console.log(JSON.stringify({status:"SIMULATION",checked:checked.length,writes:0}));process.exit(0);}
	await sql.begin(async tx=>{
		for(const {entry,fr} of checked){
			const result=await ecrirePlanche(tx,{databookId:entry.databook_id,numero:entry.page},{retirer:["text_fr","text_fr_by","text_fr_at"]},{traduction:fr});
			if(!result.applique) throw new Error(result.motif);
			await tx`insert into public.wiki_revisions ${tx({id:crypto.randomUUID().replaceAll("-","").slice(0,24),tableName:"db_databooks",rowId:String(entry.databook_id),action:"update",label:`Canary retrait traduction p${entry.page}`,before:tx.json({[`traduction#${entry.page}`]:fr}),after:tx.json({[`traduction#${entry.page}`]:null}),editorId:"agent",editorName:"Canary traductions SH-P1-008"})}`;
		}
	});
	console.log(JSON.stringify({status:"APPLIED",writes:checked.length,rollback:"wiki_revisions.before"}));
}finally{await sql.end();}
