// Adiciona os 33 novos áudios da Fase 1 (cortes de gravações reais de ATC do
// YouTube, revisados e com transcrição corrigida manualmente pela Sabrina em
// `Material Didático/ATC/Phase 1 - Audios/transcrições/`) + 60 perguntas no total
// (10 já existentes de audio01-10 + 50 novas, distribuídas entre os 33 áudios
// novos — os mais ricos em conteúdo ganham 2 perguntas em vez de 1).
//
// Aditivo, não mexe nos 10 áudios/perguntas já existentes. UPSERT por título
// (natural key) — idempotente, seguro rodar de novo.
// Uso: `node scripts/add-phase1-audios-batch2.mjs`
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { Client } from "pg";

function loadEnv() {
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    env[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = env.SUPABASE_DB_URL;

const SOURCE_DIR =
  "/Users/sabrinadeccache/Desktop/Projeto Plataforma/Material Didático/ATC/Phase 1 - Audios";

// Cada item: 1 áudio, 1-2 perguntas (prompt/opções/gabarito em português,
// transcript em inglês — mesma convenção dos 10 áudios já existentes).
const ITEMS = [
  {
    file: "v01b.mp3", title: "Esteira de turbulência e taxiamento — United 995",
    category: "navigation", difficulty: "easy",
    transcript: "United 985 heavy Newark tower caution wake turbulence you are in trail of a heavy Boeing 787, wind 160 at 5 runway 22 left cleared to land. Cleared to land 22 left United 995. United 995 heavy we're still waiting on the gate so you're going to go southbound papa then double alpha hold short of runway 22 right. Alpha papa. Hold short 22 right United 995",
    questions: [
      { prompt: "Atrás de qual aeronave a United 995 foi avisada sobre esteira de turbulência?",
        a: "Um Boeing 787", b: "Um Airbus A380", c: "Um Boeing 737", correct: "a" },
    ],
  },
  {
    file: "v01c.mp3", title: "Divergência no readback de hold short — United 995",
    category: "ground_operations", difficulty: "easy",
    transcript: "And just confirm hold short of 22 right at alpha alpha United 995 heavy. Affirmative copy United 995 heavy. Yeah I just need the full readback United 995 heavy hold short of runway 22 right at alpha alpha. 22 right at alpha alpha United 995. You just said 22 right at alpha alpha. United 995 heavy at alpha alpha hold short of runway 22 right. At alpha alpha hold short of runway 22 right United 995.",
    questions: [
      { prompt: "Onde a aeronave deveria aguardar?",
        a: "Pista 22 direita, na interseção Alpha-Alpha", b: "Pista 22 esquerda, na interseção Bravo", c: "Pista 04, na interseção Charlie", correct: "a" },
      { prompt: "Por que a torre pede a leitura de volta completa de novo?",
        a: "Porque a primeira leitura de volta não repetiu a instrução corretamente", b: "Porque houve interferência de rádio", c: "Porque a tripulação pediu repetição", correct: "a" },
    ],
  },
  {
    file: "v02a.mp3", title: "Retorno por fumaça na cabine — Cair 217",
    category: "emergency_smoke", difficulty: "easy",
    transcript: "Boston, Cair 217 request return to Boston due to smoke in the cabin. Cair 217 roger we're going to declare an emergency for you, maintain 5,000 fly heading 270. Heading 270 5,000 Cair 270.",
    questions: [
      { prompt: "Por que a Cair 217 solicitou retornar a Boston?",
        a: "Fumaça na cabine", b: "Falha de motor", c: "Pane elétrica", correct: "a" },
    ],
  },
  {
    file: "v02b.mp3", title: "Fumaça sem origem identificada — Cair 217",
    category: "emergency_smoke", difficulty: "medium",
    transcript: "we're trying to land as soon as we can, we didn't find out the source, but its smoking and its smells bad. Cair 217 roger fly heading 360 and maintain 5,000. 360 5,000 Cair 217. Cair 217 I need your souls on board and fuel on board and if there's any further assistance we can give. We got 8 souls on board and fuel about 3.0 hours of fuel.",
    questions: [
      { prompt: "A tripulação conseguiu identificar a origem da fumaça?",
        a: "Não, a origem não foi identificada", b: "Sim, era o motor esquerdo", c: "Sim, era um curto-circuito elétrico", correct: "a" },
      { prompt: "Quantas horas de combustível a tripulação informou ter a bordo?",
        a: "3 horas", b: "8 horas", c: "5 horas", correct: "a" },
    ],
  },
  {
    file: "v02c.mp3", title: "Veículo de emergência acompanha pouso — Cair 217",
    category: "emergency_smoke", difficulty: "easy",
    transcript: "Cair 217 Boston tower, logan emergency services are also on this frequency. Once you land a vehicle will follow you down the runway runway 22 right. Runway 22 right, clear to land, Cair 217.",
    questions: [
      { prompt: "O que a torre informa à Cair 217 antes do pouso?",
        a: "Que um veículo de emergência vai acompanhá-la na pista após o pouso", b: "Que a pista está interditada", c: "Que precisa aguardar em espera", correct: "a" },
    ],
  },
  {
    file: "v03a.mp3", title: "Mudança de frequência sem autorização — Virgin 25B",
    category: "ground_operations", difficulty: "medium",
    transcript: "Virgin 25 Bravo heavy hold position go back to tower 119.1. 119.1 sorry. Hold position Virgin 25 Bravo. Hold position Virgin 25B. Tower Virgin 25 Bravo is holding position. Short of 22 right. Virgin 25 Bravo heavy that is very dangerous. You were not giving a frequency change. Do not do that. Do you understand? Virgin 25B, it was a mistake on my part I'm sorry.",
    questions: [
      { prompt: "Por que a torre diz que a atitude da Virgin 25B foi \"muito perigosa\"?",
        a: "Porque mudou de frequência sem autorização da torre", b: "Porque entrou na pista sem autorização", c: "Porque decolou fora de ordem", correct: "a" },
      { prompt: "Como a tripulação da Virgin 25B reage à repreensão da torre?",
        a: "Reconhece que foi um erro dela mesma", b: "Discorda e diz que a torre errou", c: "Não responde", correct: "a" },
    ],
  },
  {
    file: "v04a.mp3", title: "Esteira de turbulência atrás de Boeing 777 — Brickyard 3544",
    category: "navigation", difficulty: "easy",
    transcript: "Tower brickyard 3544 over Grady on the visual for runway 4 right. Brickyard 3544 Newark tower roger caution wake turbulence from the heavy Boeing 777 you're following, gain of 10kt reported at 300 by a Boeing 737. Wind is 320 at 12, gust 21 runway 4 right cleared to land. Runway 4 right cleared to land, copy wind shear brickyard 3544.",
    questions: [
      { prompt: "A aeronave Brickyard 3544 foi avisada sobre esteira de turbulência atrás de qual aeronave?",
        a: "Um Boeing 777", b: "Um Boeing 737", c: "Um Airbus A320", correct: "a" },
    ],
  },
  {
    file: "v04b.mp3", title: "Erro de leitura de proa — Brickyard 3544",
    category: "ground_operations", difficulty: "medium",
    transcript: "Lindberg number 4459 Newark tower, runway 4 left line up and wait. Runway 4 left line up and wait 4459. Number 4459 wind 320 knots at 9 gusts 21, runway 4 left, cleared for takeoff. 4 left cleared for takeoff number 4459. Brickyard 3544 turn right heading 080 climb and maintain 3000. 3000, right, heading 070. Brickyard 3544 turn right heading 080.",
    questions: [
      { prompt: "Qual instrução a aeronave 4459 recebe antes de ser autorizada a decolar?",
        a: "Entrar na pista e aguardar", b: "Aguardar em espera", c: "Taxiar até o pátio", correct: "a" },
      { prompt: "A aeronave Brickyard 3544 faz a leitura de volta corretamente na primeira vez?",
        a: "Não, ela lê a proa errada (070 em vez de 080) e a torre precisa repetir", b: "Sim, na primeira vez", c: "Não, ela lê a altitude errada", correct: "a" },
    ],
  },
  {
    file: "v04c.mp3", title: "Wind shear e RA do TCAS — Brickyard 3544",
    category: "traffic_conflict", difficulty: "medium",
    transcript: "Brickyard 3544 climb and maintain 3000. In the climb, we're wind shear and TCAS RA Brickyard 3544. Roger. Brickyard 3544 turn left heading 0 ... disregard Brickyard 3544 contact departure 119.2. 119.2 Brickyard 3544.",
    questions: [
      { prompt: "O que a tripulação da Brickyard 3544 reporta durante a subida?",
        a: "Wind shear e um RA do TCAS", b: "Apenas uma falha de motor", c: "Apenas um aviso de tráfego, sem RA", correct: "a" },
      { prompt: "O que acontece com a instrução de virar à esquerda para proa zero dada à Brickyard 3544?",
        a: "É cancelada logo em seguida", b: "É confirmada e mantida", c: "É substituída por uma instrução de subida", correct: "a" },
    ],
  },
  {
    file: "v05a.mp3", title: "Surto no motor esquerdo — Southwest 975",
    category: "technical_malfunction", difficulty: "easy",
    transcript: "Hey center, Southwest 975 can you just start heading us towards back to Phoenix, that's the plan. We're going to divert back to Phoenix. We have our left engine... we had a surge and we're probably going to shut it down here, so I'd like to declare emergency and head back towards Phoenix. Southwest 975 you are cleared to Sky Harbor Airport via to a radar vectors, I'll have a turn in just a moment and do you have fuel? Yeah stand by on that and give me one second on that.",
    questions: [
      { prompt: "Por que a Southwest 975 decide retornar a Phoenix?",
        a: "Surto no motor esquerdo", b: "Falta de combustível", c: "Fumaça na cabine", correct: "a" },
    ],
  },
  {
    file: "v05b.mp3", title: "Fogo no motor esquerdo — Southwest 975",
    category: "emergency_fire", difficulty: "medium",
    transcript: "we see a little fire in your left engine, number one engine, we just see a little bit of flame happening right now. Okay, tell you what, we still had it running at a lower power, we'll shut it down and see if that goes away, let us know. Southwest 975, fire command, copy. All right, number one engine is now shut down. Southwest 975, fire command, be advised, we still have a little bit of fire and you have smoke coming out of.",
    questions: [
      { prompt: "O que a equipe de bombeiros avista no motor esquerdo da aeronave?",
        a: "Um pouco de fogo/chama", b: "Vazamento de combustível", c: "Fumaça branca apenas, sem fogo", correct: "a" },
      { prompt: "O que a tripulação decide fazer com o motor número 1 após o relato do fogo?",
        a: "Desligar o motor", b: "Aumentar a potência pra tentar apagar o fogo", c: "Reiniciar o motor", correct: "a" },
    ],
  },
  {
    file: "v05d.mp3", title: "Reboque solicitado após incêndio — Southwest 975",
    category: "emergency_fire", difficulty: "easy",
    transcript: "Southwest 975, fire command, would you like a tow team started this way? Yes, please, we will accept a tow team. Copy, we have one on the way. Southwest 975, fire command, are you able to lift your flaps a little bit? Yeah we had the flaps down just in case we needed to evacuate but we'll raise them now.",
    questions: [
      { prompt: "A tripulação aceita a equipe de reboque oferecida?",
        a: "Sim, aceita", b: "Não, recusa", c: "Pede para aguardar antes de decidir", correct: "a" },
      { prompt: "Por que os flaps estavam abaixados?",
        a: "Por precaução, caso fosse necessário evacuar", b: "Por causa de uma falha hidráulica", c: "Por instrução padrão de pouso", correct: "a" },
    ],
  },
  {
    file: "v06a.mp3", title: "Ruído não identificado no motor — Aeronave XA-MRA",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "Tower, XA-MRA, mayday mayday mayday, we have a failure, We have a noise, and we're looking at the engines, maybe it's one engine, we're going to maintain 3,000 and runway heading, if it's possible. XA-MRA, we did hear noise, I don't see anything coming from your plane at this time.",
    questions: [
      { prompt: "A tripulação consegue identificar com certeza a causa do ruído/falha?",
        a: "Não, apenas suspeita que possa ser um motor", b: "Sim, confirma falha total de um motor", c: "Sim, confirma ser o trem de pouso", correct: "a" },
      { prompt: "O que a torre observa ao verificar a aeronave visualmente?",
        a: "Não vê nada saindo da aeronave, apesar de ouvir o ruído relatado", b: "Vê fumaça saindo do motor", c: "Vê uma parte solta caindo", correct: "a" },
    ],
  },
  {
    file: "v06b.mp3", title: "Checagem visual sem fumaça — Aeronave XA-MRA",
    category: "technical_malfunction", difficulty: "easy",
    transcript: "Did you check something from the tower? I checked you out with my binoculars, I didn't see any smoke or anything come off the plane, we did hear some loud noises we didn't know where it was coming from though. Okay thank you. Yeah we're going to come back if you can give us some vectors and now we're going to climb to 3,000",
    questions: [
      { prompt: "O que o controlador viu ao checar a aeronave com binóculos?",
        a: "Nada de anormal — sem fumaça nem nada caindo da aeronave", b: "Fumaça saindo do motor direito", c: "Uma porta do compartimento de carga aberta", correct: "a" },
    ],
  },
  {
    file: "v06c.mp3", title: "Suspeita de trem de pouso — Aeronave XA-MRA",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "We thought it was an engine but right now the engines are good, maybe it's something with the landing gear, we're going to check right now some systems, but I'll call you back for that assistance, if if necessary. XA-MRA, understood, do you need some delay vectors to go through checklist, or are you ready for the approach? we can stay in this heading and make a delayed approach, XA-MRA.",
    questions: [
      { prompt: "Depois de checar os sistemas, o que a tripulação passa a suspeitar ser a causa do ruído?",
        a: "O trem de pouso, não o motor", b: "Ainda suspeita ser o motor", c: "Um problema elétrico", correct: "a" },
      { prompt: "O que a tripulação decide fazer em relação à aproximação?",
        a: "Ficar na proa atual e fazer uma aproximação com atraso, pra dar tempo ao checklist", b: "Pousar imediatamente sem terminar o checklist", c: "Solicitar desvio pra outro aeroporto", correct: "a" },
    ],
  },
  {
    file: "v07b.mp3", title: "Pedido de dados da emergência — Blue Streak 5422",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "Blue Streak 5422, can you give me souls on board and fuel remaining in time? Blue Streak 5422, I just need you to increase the rate of descent, if possible down to 10,000",
    questions: [
      { prompt: "Além de pessoas a bordo e combustível, o que mais o controle pede à Blue Streak 5422?",
        a: "Que aumente a taxa de descida até 10.000 pés", b: "Que aumente a velocidade", c: "Que mude de proa imediatamente", correct: "a" },
    ],
  },
  {
    file: "v07c.mp3", title: "Combustível e tempo pro trem de pouso — Blue Streak 5422",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "Can you give me the fuel in pounds? 7,790 lbs. Blue Streak 5422, descend and maintain 7,000. 7,000, Blue Streak 5422. Blue Streak 5422, descend and maintain 6,000, and how long... I was just going to turn you around and put you back on a downwind for 27 left, how long will you need to get the gear down? Currently down, going down to 6,000, and probably about 10 minutes just to get everything sorted and coordinated.",
    questions: [
      { prompt: "Quantas libras de combustível a tripulação informou?",
        a: "7.790 libras", b: "6.000 libras", c: "10.000 libras", correct: "a" },
      { prompt: "Quanto tempo a tripulação estima precisar para baixar o trem de pouso e organizar tudo?",
        a: "Cerca de 10 minutos", b: "Cerca de 2 minutos", c: "Cerca de 30 minutos", correct: "a" },
    ],
  },
  {
    file: "v07d.mp3", title: "Falha na direção da roda do nariz — Blue Streak 5422",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "Approach, Blue Streak 5422, we are complete and ready to go at this time, we also have, be advised, we have no nose wheel steering, so we're going to have to be stopping on the runway. Blue Streak 5422, copy all, I'll let the tower know, turn left heading 330. 330, Blue Streak 5422, thanks, we have called for a tow already, I don't know where they're at with that",
    questions: [
      { prompt: "Por que a Blue Streak 5422 vai precisar parar na pista após pousar?",
        a: "Porque não tem direção da roda do nariz", b: "Porque os freios falharam", c: "Porque um motor parou", correct: "a" },
    ],
  },
  {
    file: "v08a.mp3", title: "Tráfego de helicóptero na decolagem — JetBlue 775",
    category: "traffic_conflict", difficulty: "easy",
    transcript: "Jetblue 775, helicopter 700ft, just off you right, inbound to Kennedy, no factor, they have you insight, you can contact departure, good day. JetBlue 775 thanks for the heads up, departure Jetblue 775, 1.600 climbing 5,000 on the breezy point. JetBlue 775, New York departure, radar contact, climb and maintain 11,000. 11,000 Jetblue 775.",
    questions: [
      { prompt: "Que tipo de tráfego foi informado à JetBlue 775 logo após a decolagem?",
        a: "Um helicóptero a 700 pés, à direita", b: "Um planador", c: "Um drone", correct: "a" },
    ],
  },
  {
    file: "v08b.mp3", title: "RA do TCAS com helicóptero — JetBlue 775",
    category: "traffic_conflict", difficulty: "medium",
    transcript: "Kennedy Tower, Jetblue 775. Jetblue 775. Yeah, we just departed a couple minutes ago and we had a TCAS RA with a helicopter, we would like a phone number for you to ask and to take some marks, please. JetBlue 775 you ready for the number? Yes, sir. Copy that, and as we rotated and the nose was coming up, we had a 0 on the TCAS, same altitude, passed over him at 600 ft, we never had them insight.",
    questions: [
      { prompt: "A tripulação da JetBlue 775 chegou a avistar visualmente o helicóptero do RA?",
        a: "Não, nunca o avistaram visualmente", b: "Sim, o avistaram a tempo", c: "Sim, mas só depois do pouso", correct: "a" },
      { prompt: "A que distância vertical aproximada a JetBlue 775 passou do helicóptero?",
        a: "600 pés", b: "6.000 pés", c: "60 pés", correct: "a" },
    ],
  },
  {
    file: "v10a.mp3", title: "PAN-PAN por falha de spoilers — American 9786",
    category: "technical_malfunction", difficulty: "easy",
    transcript: "Center American 9786 pan pan pan pan pan pan, we need most direct routing into DC. American 9786, roger American 9786, cleared direct National. Direct National, American 9786. American 9786, when you get a minute, can you let me know the nature? Yes, it's a spoilers fault. Spoilers fault, roger",
    questions: [
      { prompt: "Qual foi a natureza da emergência PAN-PAN declarada pela American 9786?",
        a: "Falha nos spoilers", b: "Falha de motor", c: "Fumaça na cabine", correct: "a" },
    ],
  },
  {
    file: "v10b.mp3", title: "Equipamento de prontidão por precaução — American 9786",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "American 9786 do you need equipment standing by when you get to the airport? Negative, American 9786. Okay thank you, and you'll will you be able to exit the runway? Do you need a land short, anything special you need now? We should be fine exiting the runway, it's just a flight control issue. Okay, thank you. American 9786, out of precaution, we will need equipment on the runway. American 9786, no problem, we can have that ready for you, you can descend and maintain 6,000. Descend and maintain 6,000 American 9786.",
    questions: [
      { prompt: "A tripulação inicialmente pede equipamento de emergência de prontidão?",
        a: "Não, inicialmente diz que não precisa", b: "Sim, pede imediatamente", c: "Essa pergunta não é feita", correct: "a" },
      { prompt: "Mesmo assim, o que o controle decide fazer por precaução?",
        a: "Colocar equipamento de emergência na pista mesmo assim", b: "Fechar a pista completamente", c: "Cancelar a autorização de pouso", correct: "a" },
    ],
  },
  {
    file: "v11a.mp3", title: "Perda do motor esquerdo em final curta — United 2011",
    category: "technical_malfunction", difficulty: "easy",
    transcript: "United 2011 declaring emergency, we lost left engine. United 2011 say again? Declaring emergency, left engine failure. United 2011, roger. Do you want to still land or do you want to go around? We're going to continue to land. United 2011, you are cleared to land on runway 4 right. Cleared to land 4 right United 2011.",
    questions: [
      { prompt: "Após perder o motor esquerdo, a tripulação decide arremeter ou continuar o pouso?",
        a: "Continuar o pouso", b: "Arremeter", c: "Aguardar em espera antes de decidir", correct: "a" },
    ],
  },
  {
    file: "v11b.mp3", title: "Elogio do controlador após pouso de emergência — United 2011",
    category: "technical_malfunction", difficulty: "easy",
    transcript: "United 2011. Good job guys. Alright, United 2011, I have the trucks coming across the runways for you. You can change over 134.05, do you require any assistance? I'm sorry, say again the frequency? Change to 134.05 the emergency trucks will talk to you there. Do you require any assistance? 134.05, I don't believe we need assistance right now.",
    questions: [
      { prompt: "Como o controlador reage à forma como a tripulação lidou com a emergência?",
        a: "Elogia a tripulação", b: "Critica a demora", c: "Não comenta nada", correct: "a" },
      { prompt: "A tripulação solicita assistência adicional após o pouso?",
        a: "Não, informa que não acredita precisar de assistência", b: "Sim, pede ambulância", c: "Sim, pede reboque imediato", correct: "a" },
    ],
  },
  {
    file: "v12b.mp3", title: "Desvio para aeroporto alternativo — Lindbergh 4493",
    category: "navigation", difficulty: "easy",
    transcript: "Departure, Lindbergh 4493, 2200 climbing 2500, runway heading, we're going to need to divert to our alternate, Scranton. Okay, Lindbergh 4493, departure, radar contact, you said Scranton is your alternate? Affirm, Lindbergh 4493. Lindbergh 4493, you can climb and maintain 5000, and I'll have a route for you in a moment. Roger, 5000, copy, Lindbergh 4493",
    questions: [
      { prompt: "Para qual aeroporto alternativo a Lindbergh 4493 decide desviar?",
        a: "Scranton", b: "Allentown", c: "Newark", correct: "a" },
    ],
  },
  {
    file: "v12c.mp3", title: "Combustível mínimo e alternativo indisponível — Lindbergh 4493",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "We probably have about 5 minutes, we're already diverting here... we have about 5 minutes, Lindbergh 4493. Okay, keep me posted and then what'll be the plan after that? Stand by. Approach, Lindbergh 4493, our closest cruise alternate is not going to work for us, so we can hold for the 5 minutes and then it might be end up declaring emergency to get in to 27 left. Okay. Alright, thanks.",
    questions: [
      { prompt: "Quanto tempo a tripulação informa que ainda tem antes de precisar decidir algo?",
        a: "Cerca de 5 minutos", b: "Cerca de 30 minutos", c: "Cerca de 1 minuto", correct: "a" },
      { prompt: "O que a tripulação cogita fazer se o alternativo mais próximo não servir?",
        a: "Declarar emergência para conseguir pousar na pista 27L", b: "Desviar para outro país", c: "Sobrevoar até acabar o combustível", correct: "a" },
    ],
  },
  {
    file: "v13a.mp3", title: "Encaminhamento para aproximação ILS — Caribbean 528",
    category: "navigation", difficulty: "easy",
    transcript: "New York approach, good day, Caribbean airlines 528, 9,000 with the hotel. Caribbean 528, New York approach, hello, It's going to be ILS RWY 31 right. ILS 31 right 528.",
    questions: [
      { prompt: "Para qual aproximação a Caribbean 528 foi encaminhada?",
        a: "ILS pista 31 direita", b: "Visual pista 04", c: "RNAV pista 22 esquerda", correct: "a" },
    ],
  },
  {
    file: "v13b.mp3", title: "Alerta geral de emergência — Caribbean 528",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "Caribbean 528 when you have a chance do you have souls on board and fuel remaining in pounds? Souls on board is 153 and we have about 10,000 pounds on board. Copy, thank you. Attention all emergency equipment respond alert 4. Taxiway Charlie and taxiway Charlie 3. Attention all emergency equipment respond alert 4. Taxiway Charlie and taxiway Charlie 3.",
    questions: [
      { prompt: "Quantas pessoas a bordo a Caribbean 528 informou?",
        a: "153", b: "10.000", c: "528", correct: "a" },
      { prompt: "O que é anunciado logo depois, para todos os equipamentos de emergência?",
        a: "Um alerta geral para se dirigirem às taxiways Charlie e Charlie 3", b: "Que a emergência foi cancelada", c: "Que a pista foi liberada normalmente", correct: "a" },
    ],
  },
  {
    file: "v13c.mp3", title: "Área de estacionamento interditada — Connie 935",
    category: "ground_operations", difficulty: "medium",
    transcript: "Connie 935, heavy, where you parking today? building 260 up there Charlie 2, Charlie 3. Alright, you may have to park somewhere else, there's an emergency in that area right now but I'll find out for you. Alright, thanks. Connie 935, plan on exiting to the left off the runway and then I'll park you somewhere until they're ready for you.",
    questions: [
      { prompt: "Por que a Connie 935 pode precisar estacionar em outro lugar?",
        a: "Porque há uma emergência em andamento na área onde ela costuma estacionar", b: "Porque o portão está em manutenção", c: "Porque outra aeronave já está lá", correct: "a" },
      { prompt: "O que o controle instrui a Connie 935 a fazer ao sair da pista?",
        a: "Sair pela esquerda e aguardar até que definam onde estacionar", b: "Sair pela direita e ir direto ao portão", c: "Permanecer na pista", correct: "a" },
    ],
  },
  {
    file: "v14a.mp3", title: "Baixa pressão de óleo no motor 1 — American 2512",
    category: "technical_malfunction", difficulty: "easy",
    transcript: "Mayday, mayday, mayday it's American 2512, we're going to level-off here at 5,000 ft, we got low oil pressure in our number one engine, I'd like to return back to Dallas. American 2512, approach, roger, understood maintain either just level the aircraft, any altitude you want above 4,000 and which runway would you like?",
    questions: [
      { prompt: "Qual foi o motivo da emergência declarada pela American 2512?",
        a: "Baixa pressão de óleo no motor número 1", b: "Falha total do motor número 1", c: "Fumaça no motor número 1", correct: "a" },
    ],
  },
  {
    file: "v14b.mp3", title: "Informações ATIS e dados da emergência — American 2512",
    category: "technical_malfunction", difficulty: "easy",
    transcript: "American 2512, roger, American 2512, I know you just took off from there, but DFW ATIS W is current, wind's 180 at 7, sky clear, altimeter 30.09, just advise when you're ready to proceed inbound. Okay copy that American 2512, and be advised we have 191 total souls, no hazardous materials and we got about 5 hours of fuel on board.",
    questions: [
      { prompt: "Quantas pessoas a bordo a American 2512 informou?",
        a: "191", b: "512", c: "30", correct: "a" },
      { prompt: "A tripulação informa transportar materiais perigosos a bordo?",
        a: "Não", b: "Sim", c: "Não foi perguntado", correct: "a" },
    ],
  },
  {
    file: "v14c.mp3", title: "Rebaixamento para Pan-Pan — American 2512",
    category: "technical_malfunction", difficulty: "medium",
    transcript: "American 2512, go ahead. We'd like to downgrade it to just a pan-pan this time, we believe it's an indication problem now, but we're still returning back to Dallas, obviously. American 2512 roger, I'm sorry you got stepped on, understand pan-pan and then... what's the rest? We're still going to return back to DFW. Roger, understood, thanks.",
    questions: [
      { prompt: "Por que a tripulação rebaixa a emergência de Mayday para Pan-Pan?",
        a: "Porque agora acredita que seja apenas um problema de indicação, não real", b: "Porque o problema foi totalmente resolvido", c: "Porque outro motor também falhou", correct: "a" },
    ],
  },
  {
    file: "v15a.mp3", title: "Incursão de pista — Air Canada 898",
    category: "ground_operations", difficulty: "medium",
    transcript: "Air Canada stop, stop, stop, stop, stop, Air Canada 898, turn left V, left on U, remain this frequency, Eva 32, heavy, Air Canada was not doing what they were supposed to, left V, right B, and I'll talk to them momentarily. Left V, right B, Eva 32, heavy.",
    questions: [
      { prompt: "Por que a torre grita repetidamente \"stop\" para a Air Canada?",
        a: "Porque a aeronave não estava seguindo a instrução correta (fazendo o que não devia)", b: "Porque houve uma colisão", c: "Porque a pista foi fechada de repente", correct: "a" },
    ],
  },
];

async function upload(path, buffer) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/phase1-audios/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload falhou (${res.status}): ${body.slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/phase1-audios/${path}`;
}

function getDurationSeconds(filePath) {
  const out = execSync(`afinfo "${filePath}" | grep "estimated duration"`).toString();
  const match = out.match(/([\d.]+)\s*sec/);
  return match ? Math.round(parseFloat(match[1])) : null;
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  let audiosInserted = 0;
  let audiosUpdated = 0;
  let questionsInserted = 0;

  for (const item of ITEMS) {
    const filePath = `${SOURCE_DIR}/${item.file}`;
    const durationSeconds = getDurationSeconds(filePath);
    const buffer = readFileSync(filePath);
    const audioUrl = await upload(item.file, buffer);

    const existing = await db.query(
      `select id from public.phase1_audios where title = $1`,
      [item.title],
    );

    let audioId;
    if (existing.rows.length > 0) {
      audioId = existing.rows[0].id;
      await db.query(
        `update public.phase1_audios
           set audio_url = $1, transcript = $2, difficulty = $3, category = $4,
               accent = $5, duration_seconds = $6, is_active = true
         where id = $7`,
        [audioUrl, item.transcript, item.difficulty, item.category, "mixed", durationSeconds, audioId],
      );
      audiosUpdated++;
    } else {
      const result = await db.query(
        `insert into public.phase1_audios
          (title, audio_url, transcript, difficulty, category, accent, duration_seconds, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         returning id`,
        [item.title, audioUrl, item.transcript, item.difficulty, item.category, "mixed", durationSeconds],
      );
      audioId = result.rows[0].id;
      audiosInserted++;
    }

    // Perguntas: casadas por posição dentro do áudio (não pelo texto do prompt,
    // que pode ser editado entre rodadas — ver achado da revisão que tirou as
    // expressões em inglês entre parênteses). Sem nenhuma phase1_answers real
    // apontando pra essas perguntas ainda (confirmado antes de rodar), é seguro
    // apagar e reinserir as perguntas deste áudio a cada rodada.
    await db.query(`delete from public.phase1_questions where audio_id = $1`, [audioId]);
    for (const q of item.questions) {
      await db.query(
        `insert into public.phase1_questions
          (audio_id, prompt, option_a, option_b, option_c, correct_option, is_active)
         values ($1, $2, $3, $4, $5, $6, true)`,
        [audioId, q.prompt, q.a, q.b, q.c, q.correct],
      );
      questionsInserted++;
    }

    console.log(
      `[${item.file}] ${item.title} — ${durationSeconds}s, ${item.difficulty}, ${item.questions.length} pergunta(s)`,
    );
  }

  const totalQ = ITEMS.reduce((sum, i) => sum + i.questions.length, 0);
  console.log(
    `\nÁudios: ${audiosInserted} inseridos, ${audiosUpdated} atualizados. Perguntas novas: ${questionsInserted}.`,
  );
  console.log(`Total de perguntas neste lote: ${totalQ} (+ 10 já existentes de audio01-10 = ${totalQ + 10}).`);

  await db.end();
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
