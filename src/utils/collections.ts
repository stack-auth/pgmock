const specialConstructorCallSymbol = Symbol('specialConstructorCall');

export class BiMap<Left, Right> {
  private readonly leftToRight = new Map<Left, Right>();
  private readonly rightToLeft = new Map<Right, Left>();

  constructor(entries?: Iterable<[Left, Right]>) {
    if (Array.isArray(entries) && entries[0] === specialConstructorCallSymbol) {
      // special constructor for the inverseView method, not publicly accessible
      [this.leftToRight, this.rightToLeft] = [entries[1], entries[2]];
    } else {
      entries ??= [];
      for (const [left, right] of entries) {
        this.set(left, right);
      }
    }
  }

  public hasLeft(left: Left): boolean {
    return this.leftToRight.has(left);
  }

  public hasRight(right: Right): boolean {
    return this.rightToLeft.has(right);
  }

  public getLeft(right: Right): Left | undefined {
    return this.rightToLeft.get(right);
  }

  public getRight(left: Left): Right | undefined {
    return this.leftToRight.get(left);
  }

  public set(left: Left, right: Right): void {
    this.deleteLeft(left);
    this.deleteRight(right);
    this.leftToRight.set(left, right);
    this.rightToLeft.set(right, left);
  }

  public deleteLeft(left: Left): boolean {
    if (!this.hasLeft(left)) return false;
    const right = this.leftToRight.get(left)!;
    this.leftToRight.delete(left);
    this.rightToLeft.delete(right);
    return true;
  }

  public deleteRight(right: Right): boolean {
    if (!this.hasRight(right)) return false;
    const left = this.rightToLeft.get(right)!;
    this.leftToRight.delete(left);
    this.rightToLeft.delete(right);
    return true;
  }

  public lefts(): IterableIterator<Left> {
    return this.leftToRight.keys();
  }

  public rights(): IterableIterator<Right> {
    return this.rightToLeft.keys();
  }

  public entries(): IterableIterator<[Left, Right]> {
    return this.leftToRight.entries();
  }

  public [Symbol.iterator](): IterableIterator<[Left, Right]> {
    return this.entries();
  }

  public inverseView(): BiMap<Right, Left> {
    // call a special constructor
    return new BiMap([specialConstructorCallSymbol, this.rightToLeft, this.leftToRight] as any);
  }

  public toMap(): Map<Left, Right> {
    return new Map(this);
  }

  public toInverseMap(): Map<Right, Left> {
    return new Map(this.inverseView());
  }
}
