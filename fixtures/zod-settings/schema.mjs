export function createSchema(z) {
  return z.record(z.enum(["email", "push"]), z.boolean());
}
