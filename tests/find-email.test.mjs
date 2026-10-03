// Self-check for find-email.mjs: name → formats, public-address extraction, contacts.tsv cache.
import assert from 'node:assert/strict';
import { splitName, candidates, publicEmails, cachedEmail } from '../find-email.mjs';

assert.deepEqual(splitName('  José  María García '), { first: 'jose', last: 'garcia' });
assert.deepEqual(candidates('Jane Doe', 'acme.com').slice(0, 3), ['jane.doe@acme.com', 'jdoe@acme.com', 'jane@acme.com']);
assert.deepEqual(candidates("Jane O'Neil", 'acme.com', 'f.last'), ['j.oneil@acme.com']);
assert.deepEqual(candidates('Cher', 'acme.com'), ['cher@acme.com']);
assert.deepEqual(candidates('Jane Doe', 'acme.com', 'bogus'), []);

assert.deepEqual(publicEmails('Send CV to Jobs@Acme.com or jobs@acme.com, not x@acme.co.uk or y@notacme.com.', 'acme.com'), ['jobs@acme.com']);

const tsv = '# name\tcompany\n' + 'Jane Doe\tAcme\tHiring Manager\tEM\t-\tjane@acme.com\t-\t42\t\nBob\tAcme\tPeer\t-\t-\t-\t-\t-\t\n';
assert.equal(cachedEmail(tsv, 'jane doe', 'ACME'), 'jane@acme.com');
assert.equal(cachedEmail(tsv, 'Bob', 'Acme'), null);

console.log('find-email: ok');
