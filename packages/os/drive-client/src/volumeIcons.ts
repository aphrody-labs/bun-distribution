// @ts-nocheck
import type { CloudServiceType } from "./generated/types";
import DriveAmazonS3 from "@aphrody/assets/icons/AmazonS3.png";
import DriveGoogleDrive from "@aphrody/assets/icons/GoogleDrive.png";
import DriveDropbox from "@aphrody/assets/icons/Dropbox.png";
import DriveOneDrive from "@aphrody/assets/icons/Drive-OneDrive.png";
import DriveBackBlaze from "@aphrody/assets/icons/BackBlaze.png";
import DrivePCloud from "@aphrody/assets/icons/PCloud.png";
import DriveBox from "@aphrody/assets/icons/Box.png";
import HDDIcon from "@aphrody/assets/icons/HDD.png";
import DriveIcon from "@aphrody/assets/icons/Drive.png";
import DatabaseIcon from "@aphrody/assets/icons/Database.png";
import ServerIcon from "@aphrody/assets/icons/Server.png";

export type VolumeIcon =
	| typeof DriveAmazonS3
	| typeof DriveGoogleDrive
	| typeof DriveDropbox
	| typeof DriveOneDrive
	| typeof DriveBackBlaze
	| typeof DrivePCloud
	| typeof DriveBox
	| typeof HDDIcon
	| typeof DriveIcon
	| typeof DatabaseIcon
	| typeof ServerIcon;

// Map cloud service types to icons
const cloudProviderIcons: Record<CloudServiceType, string> = {
	s3: DriveAmazonS3,
	gdrive: DriveGoogleDrive,
	dropbox: DriveDropbox,
	onedrive: DriveOneDrive,
	gcs: DriveGoogleDrive,
	azblob: DriveBox,
	b2: DriveBackBlaze,
	wasabi: DriveAmazonS3,
	spaces: DriveAmazonS3,
	cloud: DrivePCloud,
};

/**
 * Parse cloud service type from volume mount point.
 * Cloud volumes typically have mount points like "s3://bucket-name"
 */
function parseCloudService(mountPoint: string | null): CloudServiceType | null {
	if (!mountPoint) return null;

	// Parse mount_point for cloud service (format: "s3://bucket-name")
	const match = mountPoint.match(/^(\w+):\/\//);
	if (!match) return null;

	const scheme = match[1];

	// Verify it's a cloud scheme (not file:// or other local schemes)
	const cloudSchemes: CloudServiceType[] = [
		"s3",
		"gdrive",
		"dropbox",
		"onedrive",
		"gcs",
		"azblob",
		"b2",
		"wasabi",
		"spaces",
		"cloud",
	];

	if (cloudSchemes.includes(scheme as CloudServiceType)) {
		return scheme as CloudServiceType;
	}

	return null;
}

/**
 * Determines the appropriate volume icon based on volume information.
 *
 * Priority order:
 * 1. Cloud service type (parsed from mount point)
 * 2. Volume type (External vs Internal)
 * 3. Default to generic drive icon
 */
export function getVolumeIcon(volume: {
	mount_point: string | null;
	volume_type?: import("./generated/types").VolumeType;
}): VolumeIcon {
	// Check if it's a cloud volume
	const cloudService = parseCloudService(volume.mount_point);
	if (cloudService) {
		return cloudProviderIcons[cloudService] || DriveIcon;
	}
	if (volume.volume_type === "Network") return ServerIcon;
	if (volume.volume_type === "Virtual") return DatabaseIcon;

	// For external/removable drives, use HDD icon
	if (volume.volume_type === "External" || volume.volume_type === "Removable") {
		return HDDIcon;
	}

	// Default to generic drive icon
	return DriveIcon;
}
