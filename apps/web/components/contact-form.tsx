"use client";

import { contactSchema, type ContactInput } from "@app/api/schemas/contact";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { unwrap, useApi } from "@/lib/api";
import { useToast } from "./toast";
import { Turnstile, turnstileEnabled } from "./turnstile";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Input, Textarea } from "./ui/input";

/**
 * Reference form: the same zod schema validates here and in the API (`@app/api/schemas/contact`).
 * Public forms also carry a Cloudflare Turnstile token (checked server side when TURNSTILE_SECRET_KEY is set).
 */
export function ContactForm() {
  const api = useApi();
  const toast = useToast();
  const [turnstileReset, setTurnstileReset] = useState(0);
  const form = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", phone: "", message: "", website: "", turnstileToken: "" },
  });
  const { errors } = form.formState;
  const token = useWatch({ control: form.control, name: "turnstileToken" });

  const send = useMutation({
    mutationFn: async (values: ContactInput) => unwrap(await api.contact.$post({ json: values })),
    onSuccess: () => {
      toast({ type: "success", title: "Mensagem enviada", body: "Responderemos em breve." });
      form.reset();
    },
    onError: (error) => toast({ type: "error", title: "Não foi possível enviar", body: error.message }),
    // Turnstile tokens are single-use: get a fresh one for the next attempt.
    onSettled: () => setTurnstileReset((n) => n + 1),
  });

  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit((values) => send.mutate(values))}>
      <Field label="Nome" required error={errors.name?.message}>
        <Input autoComplete="name" {...form.register("name")} />
      </Field>
      <Field label="E-mail" required error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label="Telefone" hint="Opcional" error={errors.phone?.message}>
        <Input type="tel" autoComplete="tel" inputMode="tel" {...form.register("phone")} />
      </Field>
      <Field label="Mensagem" required error={errors.message?.message}>
        <Textarea rows={5} {...form.register("message")} />
      </Field>
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
        {...form.register("website")}
      />
      <Turnstile
        action="contact"
        resetKey={turnstileReset}
        onToken={(value) => form.setValue("turnstileToken", value ?? "")}
      />
      <Button type="submit" loading={send.isPending} disabled={turnstileEnabled && !token}>
        Enviar mensagem
      </Button>
    </form>
  );
}
