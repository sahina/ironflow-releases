// One safe Ironflow subject segment: a lowercase UUID without separators, the
// shape contracts/schemas/common.v1.schema.json calls an entityId. Order ids
// and demo session ids are both this shape, so they share one definition.

export function newEntityId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
