import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * A referenceable record.
 *
 * If `attributes` is set, the references is a map of sort and can return an attribute value for a given key.
 */
export interface Reference {
  logicalId: string;
  ref: string;
  instance?: any;
  hasAtt(attribute: string): boolean;
  hasProp(property: string): boolean;
}

export class References {
  private _store: Map<string, Reference> = new Map();

  public add(reference: Reference): void {
    this._store.set(reference.logicalId, reference);
  }

  public get(logicalId: string): Reference | undefined {
    return this._store.get(logicalId);
  }
}

export class SimpleReference implements Reference {
  public constructor(public readonly logicalId: string) {}

  public get ref(): string {
    return this.logicalId;
  }

  public hasAtt(_attribute: string) {
    return false;
  }

  public hasProp(_property: string) {
    return false;
  }
}

export class InstanceReference extends SimpleReference {
  public constructor(logicalId: string, public readonly instance: any) {
    super(logicalId);
  }
}

export class ValueOnlyReference extends InstanceReference {
  public get ref(): string {
    throw new Error(`Ref: ${this.logicalId} cannot be referenced`);
  }

  public hasProp(property: string): any {
    return (
      typeof this.instance === 'object' &&
      this.instance[property as keyof Construct]
    );
  }
}

export class CfnResourceReference extends InstanceReference {
  public hasAtt(_attribute: string): boolean {
    /**
     * @todo At the moment we cannot check if a CfnResource has an attribute.
     * We would need to use L1 proper for this and could then do something like:
     * return (
     *   typeof this.instance === 'object' &&
     *   Object.prototype.hasOwnProperty.call(this.instance, 'attr' + attribute)
     * );
    );
     */
    return true;
  }
}

export class ConstructReference extends InstanceReference {
  public constructor(id: string, public readonly instance: Construct) {
    super(id, instance);
  }

  private get defaultChild(): cdk.CfnElement {
    return this.instance.node?.defaultChild as cdk.CfnElement;
  }

  public get ref(): string {
    return this.defaultChild?.logicalId;
  }

  public hasAtt(attribute: string): boolean {
    return (
      typeof this.defaultChild === 'object' &&
      Object.prototype.hasOwnProperty.call(
        this.defaultChild,
        'attr' + attribute
      )
    );
  }

  public hasProp(property: string): any {
    return (
      typeof this.instance === 'object' &&
      this.instance[property as keyof Construct]
    );
  }
}
