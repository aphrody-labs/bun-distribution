declare function dlopen(path: string): unknown;
export const lib = dlopen("libx.so");
