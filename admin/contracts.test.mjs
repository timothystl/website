import fs from 'node:fs';

let pass = 0;
let fail = 0;
const ok = (condition, message) => {
  if (condition) pass++;
  else { fail++; console.error('  ✗ ' + message); }
};

const schema = JSON.parse(fs.readFileSync(new URL('../contracts/facilities-submission-v1.schema.json', import.meta.url), 'utf8'));
const example = JSON.parse(fs.readFileSync(new URL('../contracts/examples/facilities-submission-v1.synthetic.json', import.meta.url), 'utf8'));

function resolve(part) {
  if (!part.$ref) return part;
  return part.$ref.slice(2).split('/').reduce((value, key) => value[key], schema);
}

function validate(value, rawRule, path = '$') {
  const rule = resolve(rawRule);
  const errors = [];
  if ('const' in rule && value !== rule.const) errors.push(`${path} must equal ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${path} is not an allowed value`);
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`];
    const properties = rule.properties || {};
    for (const key of rule.required || []) if (!(key in value)) errors.push(`${path}.${key} is required`);
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) errors.push(...validate(value[key], child, `${path}.${key}`));
    }
  }
  if (rule.type === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${path} has too few items`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${path} has too many items`);
    value.forEach((item, index) => errors.push(...validate(item, rule.items, `${path}[${index}]`)));
  }
  if (rule.type === 'string') {
    if (typeof value !== 'string') return [`${path} must be a string`];
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${path} is too short`);
    if (rule.maxLength !== undefined && value.length > rule.maxLength) errors.push(`${path} is too long`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${path} does not match its pattern`);
    if (rule.format === 'date-time' && (Number.isNaN(Date.parse(value)) || !value.endsWith('Z'))) errors.push(`${path} must be a UTC date-time`);
    if (rule.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) errors.push(`${path} must be an email`);
  }
  return errors;
}

function collectPropertyNames(value, names = []) {
  if (!value || typeof value !== 'object') return names;
  if (value.properties) names.push(...Object.keys(value.properties));
  for (const child of Object.values(value)) collectPropertyNames(child, names);
  return names;
}

console.log('\nfacilities submission contract');
ok(schema.$id === 'urn:timothy:website:facilities-submission:v1', 'schema has the stable v1 identity');
ok(schema.additionalProperties === false, 'root rejects unknown fields');
ok(schema.properties.dataClassification.const === 'restricted-personal', 'personal intake is classified explicitly');
ok(schema.properties.sourceProduct.const === 'website', 'Website is the producer');
ok(schema.properties.consumerProduct.const === 'connect', 'Connect is the consumer');
ok(Object.values(schema.$defs).every((definition) => definition.additionalProperties === false), 'every nested object is closed');

const errors = validate(example, schema);
ok(errors.length === 0, 'the synthetic example validates: ' + errors.join('; '));
ok(example.submissionId.includes('SYNTHETIC') && example.request.contact.email.endsWith('.invalid'), 'the example is unmistakably synthetic');

const names = collectPropertyNames(schema).join(' ');
ok(!/card|bank|routing|accountNumber|payment|transaction|donor|giving|payroll|childId|familyId|personId/i.test(names),
  'the intake contract excludes financial instruments, gifts, payroll, family/child records, and Connect person ids');

const withPayment = structuredClone(example);
withPayment.request.paymentAmountCents = 5000;
ok(validate(withPayment, schema).some((error) => error.includes('paymentAmountCents is not allowed')),
  'an unexpected payment field fails closed');

const wrongConsumer = structuredClone(example);
wrongConsumer.consumerProduct = 'finance';
ok(validate(wrongConsumer, schema).some((error) => error.includes('consumerProduct')),
  'a payload addressed to another consumer fails closed');

const noConsent = structuredClone(example);
noConsent.request.consent.privacyAcknowledged = false;
ok(validate(noConsent, schema).some((error) => error.includes('privacyAcknowledged')),
  'missing privacy acknowledgement fails closed');

const unknownVersion = structuredClone(example);
unknownVersion.contract = 'website.facilities-submission.v2';
ok(validate(unknownVersion, schema).some((error) => error.includes('contract')),
  'an unknown major contract fails closed');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
