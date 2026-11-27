import { Validator, type Schema } from '@cfworker/json-schema';
import demo from './demo.json' with { type: 'json' };
import assigned from './experiment_assigned.json' with { type: 'json' };
import exposed from './experiment_exposed.json' with { type: 'json' };
import identity from './identity_linked.json' with { type: 'json' };

function validators(schemas: Array<{ $id: string; type: string }>) {
  return new Map(schemas.map((schema) => {
    if (schema.type !== 'object') throw new Error(`Expected an object event schema: ${schema.$id}`);
    return [schema.$id, new Validator({ ...schema, type: 'object' } satisfies Schema, '7', true)];
  }));
}

export const identitySchema = identity.$id;
export const experimentAssignedSchema = assigned.$id;
export const experimentExposedSchema = exposed.$id;
export const sharedEvents = validators([assigned, exposed, identity]);

export const projects = new Map([
  ['demo', {
    origins: ['http://127.0.0.1:5173', 'http://127.0.0.1:5182', 'https://demo.example'],
    events: validators(demo),
  }],
]);
