// Fixture de test : `Omit` hors clause d'héritage. L'extraction DOIT échouer.
export interface Base {
  a: string;
  b: number;
}

export type Derived = Omit<Base, "a">;
