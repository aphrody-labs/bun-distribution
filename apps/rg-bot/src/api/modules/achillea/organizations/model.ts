import { t } from "elysia";

const person = t.Object({
  id: t.String(),
  username: t.Nullable(t.String()),
  displayName: t.String(),
  avatar: t.Nullable(t.String()),
});

export const OrganizationModel = {
  person,
  organization: t.Object({
    id: t.Number(),
    name: t.String(),
    normalizedName: t.String(),
    logo: t.String(),
    description: t.String(),
    state: t.Number(),
    preapproved: t.Boolean(),
    origin: t.String(),
    createdAt: t.String(),
    updatedAt: t.String(),
    owner: t.Nullable(person),
    managers: t.Array(person),
  }),
  listResponse: t.Object({
    data: t.Array(
      t.Object({
        id: t.Number(),
        name: t.String(),
        normalizedName: t.String(),
        logo: t.String(),
        description: t.String(),
        state: t.Number(),
        preapproved: t.Boolean(),
        origin: t.String(),
        createdAt: t.String(),
        updatedAt: t.String(),
        owner: t.Nullable(person),
        managers: t.Array(person),
      }),
    ),
    count: t.Number(),
  }),
  notFound: t.Object({ message: t.String() }),
  unauthorized: t.Object({ message: t.Literal("Authentication required") }),
};
