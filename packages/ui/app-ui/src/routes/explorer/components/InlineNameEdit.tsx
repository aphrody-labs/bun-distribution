// SPDX-License-Identifier: Apache-2.0
import type { File } from "@aphrody/drive-client";
import { RenameInput } from "@aphrody/m3-explorer";

export interface InlineNameEditProps {
	file: File;
	onSave: (newName: string) => Promise<void>;
	onCancel: () => void;
	className?: string;
}

/**
 * Domain adapter over @aphrody/m3-explorer's generic RenameInput component.
 */
export function InlineNameEdit({ file, onSave, onCancel, className }: InlineNameEditProps) {
	return (
		<RenameInput
			name={file.name}
			extension={file.extension && file.extension.length > 0 ? file.extension : undefined}
			onSave={onSave}
			onCancel={onCancel}
			className={className}
		/>
	);
}
