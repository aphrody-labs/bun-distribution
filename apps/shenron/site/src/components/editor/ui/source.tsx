"use client";

/**
 * Vue **source** — l'échappatoire indispensable d'un éditeur riche : quand la
 * mise en page sort des blocs prévus (HTML pointu, correctif ponctuel), on doit
 * pouvoir écrire le texte tel qu'il sera stocké.
 *
 * CodeMirror 6 (déjà dans le projet) : coloration markdown + HTML, retour à la
 * ligne, et pas de reformatage automatique — ce qu'on tape est ce qui est
 * enregistré.
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import CodeMirror, { oneDark } from "@uiw/react-codemirror";

const CM_EXTENSIONS = [
	markdown({ base: markdownLanguage, codeLanguages: languages }),
	EditorView.lineWrapping,
];

export function SourceView({
	value,
	onChange,
	height = "60vh",
	readOnly,
}: {
	value: string;
	onChange: (v: string) => void;
	height?: string;
	readOnly?: boolean;
}) {
	return (
		<CodeMirror
			value={value}
			onChange={onChange}
			extensions={CM_EXTENSIONS}
			theme={oneDark}
			height={height}
			readOnly={readOnly}
			basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
			placeholder="Markdown et HTML…"
			className="overflow-hidden text-[13px]"
		/>
	);
}
