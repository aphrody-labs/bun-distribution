<!-- SPDX-License-Identifier: Apache-2.0 -->
# Audit des exports `Form`

## Conclusion

Ne pas fusionner ni supprimer les exports `Form` de `@aphrody/m3-primitives` et
`@aphrody/m3-forms` sur la seule base de leur nom. Ils ont des contrats et des
rôles distincts; remplacer l'un par l'autre casserait des usages valides.

| Export | Contrat observé | Usage dans le dépôt |
| --- | --- | --- |
| `@aphrody/m3-primitives` `Form` | Élément HTML `<form>` enveloppé dans `FormProvider`; reçoit `form: UseFormReturn`, `disabled`, et un `onSubmit` transformé par `handleSubmit`. | `Dialog` l'utilise en interne pour ses formulaires de dialogue. Il est aussi documenté comme export public. `FormRoot` est déjà son alias explicite. |
| `@aphrody/m3-forms` `Form` | Alias direct de `react-hook-form` `FormProvider`; reçoit les méthodes via props (`<Form {...form}>`) et ne crée pas d'élément HTML `<form>`. | Utilisé par l'exemple Next et le showcase SpaceUI; documenté comme provider public. |

Les contrats diffèrent sur le type de props, la soumission HTML, le `fieldset`
désactivable et la sémantique d'élément. Le formulaire de `m3-primitives` ne
peut donc pas être remplacé par le provider de `m3-forms` sans réécrire le
dialogue et perdre le wrapper HTML. À l'inverse, faire du provider de
`m3-forms` un élément HTML changerait l'API attendue par ses consommateurs.

## Périmètre vérifié

- L'index public de `m3-primitives` exporte `Form`, `FormRoot`, `FormProps`,
  `FormRootProps`, `ErrorMessage`, `errorStyles` et `z`; son README liste ces
  exports comme surface « Forms ».
- `Dialog.tsx` importe directement l'implémentation locale et le type `FormProps`.
- L'index public de `m3-forms` exporte son `Form` avec les composants de champ;
  son README précise que `Form` est `react-hook-form`'s `FormProvider`.
- Les deux exemples actifs importent `Form` depuis `@aphrody/m3-forms` et
  l'utilisent en tant que provider. Aucun consommateur applicatif trouvé
  n'importe `Form` depuis `@aphrody/m3-primitives`.
- Les tests de `m3-primitives` importent son wrapper directement par chemin
  source, et testent séparément son rôle; le dialogue en dépend à l'exécution.

## Suite recommandée

Conserver les deux contrats pour cette déduplication. À une évolution majeure,
retirer `Form` du barrel public de `m3-primitives` seulement après avoir
conservé `FormRoot` comme wrapper HTML documenté, déplacé les exports génériques
`ErrorMessage`/`errorStyles`/`z` si nécessaire, et vérifié les usages externes
et la politique de compatibilité publiée. Pour l'instant, décrire le premier
comme wrapper HTML (`FormRoot`) et le second comme provider (`Form`) dans les
docs évite l'ambiguïté sans migration risquée.
