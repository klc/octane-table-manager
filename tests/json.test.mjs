// npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatJson, isJson } from '../resources/js/json.js';

const stored = '{"id":12345678901234567890,"price":1.50,"exp":1e3,"s":"a \\"q\\" {not: [json]}, ok","e":{},"l":[],"n":[1,{"x":null}]}';

test('minify(indent(x)) gives back the stored text exactly', () => {
    assert.equal(formatJson(formatJson(stored, 2), 0), stored);
});

test('numbers and strings keep their exact text', () => {
    const pretty = formatJson(stored, 2);
    assert.match(pretty, /"id": 12345678901234567890,/);
    assert.match(pretty, /"price": 1\.50,/);
    assert.match(pretty, /"exp": 1e3,/);
    assert.match(pretty, /"s": "a \\"q\\" \{not: \[json\]\}, ok",/);
    assert.match(pretty, /"e": \{\},\n {2}"l": \[\],/);
});

test('indents nested values', () => {
    assert.equal(formatJson('{"a":[1,2]}', 2), '{\n  "a": [\n    1,\n    2\n  ]\n}');
});

test('isJson only accepts objects and arrays', () => {
    assert.equal(isJson('{"a":1}'), true);
    assert.equal(isJson(' [1]'), true);
    assert.equal(isJson('12'), false);
    assert.equal(isJson('"text"'), false);
    assert.equal(isJson('{broken'), false);
    assert.equal(isJson(5), false);
});
