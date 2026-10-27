/** Pure chat rules: premium gating and message deletion permissions. */

export function isPremium(premiumUntil: string | null | undefined, now: Date = new Date()): boolean {
  return !!premiumUntil && new Date(premiumUntil).getTime() > now.getTime();
}

/** Only the sender may delete a message for everyone. */
export function canDeleteForEveryone(viewerId: string, senderId: string): boolean {
  return viewerId === senderId;
}

/** Deleted-for-everyone messages stay visible to premium members. */
export function messageVisibleTo(deletedForEveryone: boolean, viewerPremium: boolean): boolean {
  return !deletedForEveryone || viewerPremium;
}

/** View-once media can be opened again by premium members. */
export function oneViewReopenable(hasViewed: boolean, viewerPremium: boolean): boolean {
  return !hasViewed || viewerPremium;
}
