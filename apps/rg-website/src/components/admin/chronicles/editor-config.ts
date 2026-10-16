import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";

export const editorExtensions = [
  StarterKit,
  Placeholder.configure({
    placeholder: 'Écrivez votre chronique... (Appuyez sur "/" pour les commandes)',
  }),
];

export const editorProps = {
  attributes: {
    class: "prose prose-sm max-w-none p-4 min-h-[400px] focus:outline-none",
  },
};
