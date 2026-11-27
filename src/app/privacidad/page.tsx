// Política de privacidad. Describe solo el tratamiento real de FuelShift 1.2.0;
// cualquier cambio de proveedores, del Worker de rutas o de los datos enviados
// debe reflejarse aquí (ADR 0007). Fuentes consultadas el 27 de noviembre de 2026.
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { pageMetadata } from "@/app/site-metadata";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";

export const metadata: Metadata = pageMetadata({
  title: "Privacidad | FuelShift",
  description:
    "Qué datos trata FuelShift, con qué proveedores, durante cuánto tiempo y cómo ejercer tus derechos.",
  path: "/privacidad/",
});

const UPDATED_AT = "27 de noviembre de 2026";

/**
 * Identidad y contacto del responsable del tratamiento (art. 13.1.a RGPD).
 * Solo los aporta el propietario. Mientras falten, la página lo indica en
 * lugar de inventarlos y la publicación queda pendiente (docs/release.md).
 */
const CONTROLLER = {
  name: "Jorge Arce Nicolás",
  contact: "jorgearcenicolas7@gmail.com",
};

const LINK =
  "text-accent hover:text-accent-strong font-medium underline underline-offset-2";

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={LINK} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-ink text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="text-ink-2 mt-3 space-y-3 text-[0.9375rem] leading-7">
        {children}
      </div>
    </section>
  );
}

const RETENTION: readonly (readonly [string, string, string])[] = [
  [
    "Seudónimo de tu conexión (hash con secreto de la IP; en IPv6, de su red /64) y clave de cada consulta",
    "Servicio de rutas de FuelShift (Cloudflare Durable Objects)",
    "Unas 48 h. Los borra una alarma automática, que puede retrasarse algo",
  ],
  [
    "Registros contables sin identificador (servicio, créditos y hora)",
    "Servicio de rutas de FuelShift",
    "48 h. Un cobro sin liquidar se conserva, sin identificador, hasta reconciliarlo",
  ],
  [
    "Cuerpo, cabeceras, IP y hora de cada petición de rutas o direcciones",
    "Geoapify",
    "En general, no más de 24 h. Hasta 2 meses ante actividad sospechosa o fraudulenta",
  ],
  [
    "IP y datos técnicos de cada visita y petición",
    "Cloudflare",
    "Según la política de Cloudflare, que no publica un plazo concreto",
  ],
  [
    "Ubicación, direcciones elegidas y rutas calculadas",
    "Tu navegador, en memoria",
    "Hasta cerrar o recargar la página. No se guardan en el dispositivo",
  ],
];

export default function PrivacidadPage() {
  return (
    <div className="min-h-screen">
      <SkipLink />
      <SiteHeader active={null} />
      <main id="contenido" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">
          Privacidad
        </h1>
        <p className="text-muted mt-2 text-sm">
          Última actualización: {UPDATED_AT}.
        </p>
        <p className="text-ink-2 mt-6 text-[0.9375rem] leading-7">
          FuelShift no tiene cuentas de usuario, no usa cookies y no carga
          herramientas de analítica ni de publicidad. La mayoría de funciones se
          ejecutan en tu navegador con datos públicos de MITECO. Aquí se
          explican los pocos datos personales que se tratan y quién los recibe.
        </p>

        <Section id="responsable" title="Responsable del tratamiento">
          {CONTROLLER ? (
            <p>
              {CONTROLLER.name}. Contacto: {CONTROLLER.contact}.
            </p>
          ) : (
            <p
              role="note"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
            >
              Pendiente: el titular de FuelShift todavía no ha publicado su
              identidad ni un medio de contacto para cuestiones de privacidad.
            </p>
          )}
        </Section>

        <Section id="visita" title="Al visitar la web">
          <p>
            La web es un sitio estático alojado en Cloudflare Pages. Para
            entregarte las páginas y protegerlas frente a ataques, Cloudflare
            trata tu dirección IP y los datos técnicos de cada petición (página
            pedida, navegador y hora). FuelShift no recibe esos datos de forma
            individual.
          </p>
          <p>
            El mapa descarga su cartografía directamente de{" "}
            <External href="https://openfreemap.org/">OpenFreeMap</External>,
            que recibe tu IP y la zona del mapa que consultas, sin cuenta ni
            clave.
          </p>
        </Section>

        <Section id="ubicacion" title="Tu ubicación">
          <p>
            Solo se usa si pulsas el botón de ubicación y das permiso en el
            navegador. Sirve para ordenar las gasolineras por distancia y se
            queda en tu navegador durante la visita. Únicamente sale de él si
            calculas un repostaje (siguiente apartado) o si abres «Cómo llegar»,
            que te lleva a{" "}
            <External href="https://wiki.osmfoundation.org/wiki/Privacy_Policy">
              OpenStreetMap
            </External>{" "}
            con tu punto de salida en el enlace.
          </p>
        </Section>

        <Section id="repostaje" title="Repostar cerca de mí y durante un viaje">
          <p>
            Solo cuando pulsas «Calcular ahorro», «Mostrar recorrido» o buscas
            una dirección, tu navegador envía al servicio de rutas de FuelShift
            (un Worker de Cloudflare) el punto de salida redondeado a unos 11 m,
            el destino si lo hay y las coordenadas de hasta 15 gasolineras, o el
            texto de la dirección. El servicio los reenvía a{" "}
            <External href="https://www.geoapify.com/privacy-policy/">
              Geoapify
            </External>{" "}
            para calcular distancias, tiempos y sugerencias de direcciones. No
            reenvía tu IP ni las cabeceras de tu navegador: Geoapify recibe la
            petición desde Cloudflare.
          </p>
          <p>
            FuelShift no guarda trayectos ni direcciones legibles y no activa
            registros de las peticiones del servicio de rutas. Para limitar
            abusos y no superar la cuota gratuita del proveedor, guarda unas 48
            h un seudónimo de tu conexión y una clave de cada consulta. Ambos se
            calculan con un secreto y no permiten recuperar la consulta ni la
            IP.
          </p>
        </Section>

        <Section id="finalidad" title="Finalidad y base jurídica">
          <p>
            Servir la web, protegerla frente a abusos y calcular las rutas que
            pides se basa en el interés legítimo de ofrecer un servicio público,
            gratuito y seguro (art. 6.1.f del RGPD). Las rutas solo se calculan
            a petición tuya y la ubicación requiere, además, el permiso del
            navegador. No se elaboran perfiles, no se toman decisiones
            automatizadas con efectos sobre ti y no se ceden datos con fines
            comerciales.
          </p>
        </Section>

        <Section id="proveedores" title="Proveedores y transferencias">
          <ul className="list-disc space-y-3 pl-5">
            <li>
              <strong>Cloudflare, Inc.</strong> (EE. UU.): aloja la web y el
              servicio de rutas como encargado del tratamiento, según su{" "}
              <External href="https://www.cloudflare.com/cloudflare-customer-dpa/">
                acuerdo de tratamiento de datos
              </External>
              . Las transferencias a EE. UU. se amparan en el Marco de
              Privacidad de Datos UE-EE. UU. y, en su defecto, en cláusulas
              contractuales tipo. Para la seguridad y el funcionamiento de su
              red, Cloudflare actúa como responsable según su{" "}
              <External href="https://www.cloudflare.com/privacypolicy/">
                política de privacidad
              </External>
              .
            </li>
            <li>
              <strong>Geoapify (KEPTAGO LTD, Chipre)</strong>: calcula rutas y
              direcciones como encargado del tratamiento. Su{" "}
              <External href="https://www.geoapify.com/data-processing-agreement/">
                acuerdo de tratamiento de datos
              </External>{" "}
              estándar se aplica automáticamente a la cuenta gratuita de
              FuelShift, según confirmó Geoapify por escrito el 27 de noviembre
              de 2026. Según ese acuerdo, el tratamiento se realiza en la UE y
              sus subencargados incluyen Cloudflare (Cloudflare, Inc. y
              Cloudflare Germany GmbH) para las peticiones a api.geoapify.com,
              la dirección que usa FuelShift.
            </li>
            <li>
              <strong>OpenFreeMap</strong>: cartografía del mapa, que tu
              navegador descarga directamente.
            </li>
          </ul>
        </Section>

        <Section id="conservacion" title="Plazos de conservación">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm leading-6">
              <caption className="sr-only">
                Datos conservados, lugar y plazo
              </caption>
              <thead>
                <tr className="border-line border-b">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Datos
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Dónde
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Plazo
                  </th>
                </tr>
              </thead>
              <tbody>
                {RETENTION.map(([data, place, period]) => (
                  <tr key={data} className="border-line border-b align-top">
                    <td className="py-2 pr-4">{data}</td>
                    <td className="py-2 pr-4">{place}</td>
                    <td className="py-2">{period}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="derechos" title="Tus derechos">
          <p>
            Puedes ejercer los derechos de acceso, rectificación, supresión,
            oposición, limitación y portabilidad ante el responsable
            {CONTROLLER ? ` (${CONTROLLER.contact})` : ""}. Como FuelShift solo
            guarda seudónimos que no permiten identificarte y los borra en unas
            48 h, normalmente no podrá asociar ningún dato a tu persona. También
            puedes reclamar ante la{" "}
            <External href="https://www.aepd.es/">
              Agencia Española de Protección de Datos
            </External>
            .
          </p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
