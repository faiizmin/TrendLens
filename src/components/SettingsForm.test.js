import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import SettingsForm from './SettingsForm.jsx';

const initial = { name: 'Jamie Morgan', email: 'jamie@example.com' };
const fields = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'email', label: 'Email address', type: 'email', required: true },
];
const validate = (draft) => {
  const errors = {};
  if (!draft.name.trim()) errors.name = 'Enter your name.';
  if (!/^\S+@\S+\.\S+$/.test(draft.email)) errors.email = 'Enter a valid email address.';
  return errors;
};

function mountForm(overrides = {}) {
  const onSave = overrides.onSave || (() => ({ ok: true }));
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(SettingsForm, {
    id: 'profile', title: 'User profile', description: 'Edit details', fields,
    initialValue: initial, validate, onSave, onCancel: () => {}, ...overrides,
  })); });
  return { renderer, onSave };
}

function edit(renderer, name, value) {
  const input = renderer.root.findAllByType('input').find((node) => node.props.name === name);
  act(() => input.props.onChange({ target: { name, value } }));
}

test('controlled inputs edit and save the updated profile', () => {
  let saved;
  const { renderer } = mountForm({ onSave: (draft) => { saved = { ...draft }; return { ok: true }; } });
  edit(renderer, 'name', 'Alex Kim');
  edit(renderer, 'email', 'alex@example.com');
  act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(saved, { name: 'Alex Kim', email: 'alex@example.com' });
  assert.equal(renderer.root.findAll((node) => node.props.role === 'status')[0].children[0], 'Changes saved successfully.');
});

test('cancel discards edited values and restores the saved input values', () => {
  const { renderer } = mountForm();
  edit(renderer, 'name', 'Unsaved Name');
  act(() => renderer.root.findAllByType('button').find((node) => node.children.includes('Cancel')).props.onClick());
  const name = renderer.root.findAllByType('input').find((node) => node.props.name === 'name');
  assert.equal(name.props.value, initial.name);
});

test('invalid input displays errors and does not call save', () => {
  let saveCalls = 0;
  const { renderer } = mountForm({ onSave: () => { saveCalls += 1; return { ok: true }; } });
  edit(renderer, 'email', 'not-an-email');
  act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(saveCalls, 0);
  assert.equal(renderer.root.findAll((node) => node.props.role === 'alert')[0].children[0], 'Enter a valid email address.');
});
