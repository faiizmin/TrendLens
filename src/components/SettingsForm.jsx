import React, { useState } from 'react';

export default function SettingsForm({ id, title, description, fields, initialValue, validate, onSave, onCancel = () => {}, saveLabel = 'Save changes' }) {
  const [draft, setDraft] = useState(() => ({ ...initialValue }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);

  function changeField(event) {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: '' }));
    setMessage(null);
  }

  function submit(event) {
    event.preventDefault();
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    setMessage(null);
    if (Object.keys(nextErrors).length) return;
    const result = onSave(draft);
    if (result.ok) setMessage({ type: 'success', text: 'Changes saved successfully.' });
    else setMessage({ type: 'error', text: result.error });
  }

  function cancel() {
    setDraft({ ...initialValue });
    setErrors({});
    setMessage(null);
    onCancel();
  }

  return <section className="settings-card" aria-labelledby={`${id}-heading`}>
    <div className="settings-card-heading"><div><h2 id={`${id}-heading`}>{title}</h2><p>{description}</p></div></div>
    <form onSubmit={submit} noValidate>
      <div className="settings-fields">{fields.map((field) => <div className="settings-field" key={field.name}>
        <label htmlFor={`${id}-${field.name}`}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>
        <input id={`${id}-${field.name}`} name={field.name} type={field.type || 'text'} value={draft[field.name] ?? ''} onChange={changeField} autoComplete={field.autoComplete} aria-invalid={Boolean(errors[field.name])} aria-describedby={errors[field.name] ? `${id}-${field.name}-error` : undefined} />
        {errors[field.name] && <span className="field-error" id={`${id}-${field.name}-error`} role="alert">{errors[field.name]}</span>}
      </div>)}</div>
      {message && <div className={`settings-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}
      <div className="settings-actions"><button className="settings-cancel" type="button" onClick={cancel}>Cancel</button><button className="settings-save" type="submit">{saveLabel}</button></div>
    </form>
  </section>;
}
