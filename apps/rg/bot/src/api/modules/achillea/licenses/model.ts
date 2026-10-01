import { t } from "elysia";

export const LicenseModel = {
	license: t.Object({
		id: t.String(),
		userId: t.String(),
		licenseNumber: t.String(),
		issuedAt: t.String(),
		validUntil: t.String(),
		status: t.String(),
		pdfUrl: t.Nullable(t.String()),
		createdAt: t.String(),
		updatedAt: t.String(),
	}),
	me: t.Object({
		license: t.Nullable(
			t.Object({
				id: t.String(),
				userId: t.String(),
				licenseNumber: t.String(),
				issuedAt: t.String(),
				validUntil: t.String(),
				status: t.String(),
				pdfUrl: t.Nullable(t.String()),
				createdAt: t.String(),
				updatedAt: t.String(),
			})
		),
		verificationToken: t.Nullable(t.String()),
	}),
	verify: t.Object({
		valid: t.Boolean(),
		reason: t.Optional(
			t.Union([t.Literal("not_found"), t.Literal("revoked"), t.Literal("expired")])
		),
		licenseNumber: t.Optional(t.String()),
		validUntil: t.Optional(t.String()),
		holder: t.Optional(t.Object({ displayName: t.String(), avatar: t.Nullable(t.String()) })),
	}),
};
