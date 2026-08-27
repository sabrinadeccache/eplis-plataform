// Conteúdo inicial da trilha do piloto (SDEA). Partes 2 a 4 vêm das 5 provas
// reais levantadas: 1 prova-modelo oficial da ANAC (fixed_wing, "Modelo
// SDEA.pdf") + 4 provas reais de helicóptero (rotary_wing, "Test 1-4
// helicopter ICAO 2024"). Parte 1 usa um pool próprio de 30 perguntas abertas
// (pool 'general', agnóstico ao tipo de aeronave) escrito pela Sabrina —
// substituiu as 15 originais das provas-modelo. Ampliação das Partes 2 a 4 pra
// "dezenas por parte" fica pra uma rodada separada (decisão fechada com a
// Sabrina), igual ao histórico do EPLIS.
//
// Idempotente via UPSERT (nunca delete-and-reinsert, convenção do CLAUDE.md):
// Parte 1 casa por prompt_text (pool 'general', compartilhado entre
// perfis); Partes 2 e 3 casam por (aircraft_type, order_index) — cada prova
// contribui um bloco contíguo de order_index; Parte 4 casa por image_url.
// Item que sair da lista é só desativado (is_active = false), nunca apagado.
//
// Uso: `node scripts/seed-pilot-prompts.mjs`. Rode ANTES:
//   - scripts/upload-pilot-part2-part4-images.mjs (fotos de complicação da Parte 2)
//   - scripts/upload-pilot-part4-images.mjs (13+10 fotos da Parte 4)
// Rode DEPOIS:
//   - scripts/generate-pilot-prompt-audio.mjs (áudios de rádio das Partes 2 e 3)
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { publicUrlFor } from "./upload-pilot-part2-part4-images.mjs";
import { part4Url } from "./upload-pilot-part4-images.mjs";

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

const PART1 = [
  // Bloco 1 — conhecimento operacional / técnico (perguntas 1-10)
  "What are the main causes of flight delays?",
  "When do pilots decide to divert to an alternate aerodrome?",
  "How do crew members handle a passenger who becomes ill during a flight?",
  "What kind of weather conditions can make a landing difficult?",
  "Why is standard phraseology so important in radio communications?",
  "What does a pilot check during the walk-around inspection?",
  "How does fatigue affect a pilot's performance?",
  "What happens when an aircraft experiences a bird strike?",
  "Who is responsible for the safety of an aircraft on the ground?",
  "How do pilots and air traffic controllers avoid misunderstandings?",
  // Bloco 2 — experiência pessoal / carreira (perguntas 11-20)
  "How did you become interested in aviation?",
  "Tell me about your first solo flight.",
  "Have you ever faced a difficult weather situation during a flight?",
  "What was the most challenging part of your flight training?",
  "Describe a flight you will never forget.",
  "Have you ever had a problem communicating in English during a flight?",
  "Tell me about an interesting airport you have flown from.",
  "Was there a moment when you had to make a quick decision in the cockpit?",
  "How was your experience working with different crew members?",
  "Have you ever witnessed or heard about an incident at an airport?",
  // Bloco 3 — opinião / futuro da aviação (perguntas 21-30)
  "In your opinion, what is the biggest safety challenge in aviation today?",
  "Do you think automation makes flying safer? Why?",
  "What would you do if you lost radio contact with ATC?",
  "How do you think pilot training will change in the next twenty years?",
  "In your opinion, should airlines invest more in crew rest facilities?",
  "What would you do if a passenger became aggressive during a flight?",
  "Do you believe unmanned aircraft will replace pilots one day?",
  "How can aviation become more environmentally friendly?",
  "If you could improve one thing at the airport where you work, what would it be?",
  "What advice would you give to someone who wants to become a pilot?",
];

// Parte 2 — 5 sub-turnos por situação: contexto (prompt_text), instrução do
// controlador (atc_audio_text) que o candidato transforma em readback
// (expected_readback, só referência pra IA), narração do imprevisto
// (complication_text, às vezes + foto), reação esperada (expected_reaction,
// só referência), resposta de confirmação do controlador
// (atc_followup_audio_text) e a confirmação/negação esperada
// (expected_confirmation, só referência).
const PART2_FIXED_WING = [
  {
    prompt_text: "You have just taken off from Miami Airport. Listen to Miami Tower and read back.",
    atc_audio_text:
      "LEVEL 6, maintain runway heading, climb to seven thousand feet, squawk four four three seven. Contact Miami Departure on frequency one two two point four.",
    expected_readback:
      "Miami Departure, maintain runway heading, climb to 7,000ft, squawk/transponder 4437 and contact Miami Departure on 122.4, LEVEL 6.",
    complication_text:
      "Now, your main altimeter and the stand-by one are showing different indications and you have decided to maintain current altitude. Call Miami Departure to report the situation and say your intentions.",
    complication_image_url: null,
    expected_reaction: "Miami Departure, I have unreliable altimeter indications (+intentions), LEVEL 6.",
    atc_followup_audio_text:
      "LEVEL 6, maintain present altitude, there is no traffic in this sector. Confirm you have unreliable altimeter indications.",
    expected_confirmation:
      "AFFIRM, I have unreliable altimeter indications. Maintaining present altitude, LEVEL 6.",
  },
  {
    prompt_text: "You are going to land at Malpensa Airport in Milan. Listen to Milan Center and read back.",
    atc_audio_text:
      "LEVEL 6, descend to flight level one zero zero. Pass ODINA intersection above flight level one eight zero. When reaching flight level one zero zero, call Milan Radar on frequency one two six decimal three.",
    expected_readback:
      "Milan Radar, descend to FL100, pass Odina intersection above FL180. When reaching FL100 call Milan Approach on 126.3, LEVEL 6.",
    complication_text:
      "Now, when reaching flight level one zero zero, you notice that your first officer is unconscious. Call Milan Radar to report the situation and say your intentions.",
    complication_image_url: null,
    expected_reaction:
      "Milan Radar, my first officer fainted/passed out/is unconscious/is incapacitated (+intentions), LEVEL 6.",
    atc_followup_audio_text:
      "LEVEL 6, Milan Radar. Confirm your captain is incapacitated. Proceed direct to Saronno VOR and descend to three thousand feet.",
    expected_confirmation:
      "NEGATIVE, my first officer fainted/passed out/is unconscious/is incapacitated. Proceed direct to Saronno VOR and descend to 3,000 ft, LEVEL 6.",
  },
  {
    prompt_text: "You are going to land at Frankfurt Airport. Listen to Frankfurt Center and read back.",
    atc_audio_text: "LEVEL 6, traffic is overtaken. Descend to flight level two niner zero.",
    expected_readback: "Frankfurt Center, traffic overtaken, descend to FL 290, LEVEL 6.",
    complication_text:
      "Imagine you have just experienced a rapid decompression. Call Frankfurt Center to report the situation and say your intentions.",
    complication_image_url: null,
    expected_reaction:
      "Mayday, Mayday, Mayday, Frankfurt Center, LEVEL 6. We've had a rapid decompression (+intentions).",
    atc_followup_audio_text:
      "LEVEL 6, descend to flight level zero niner zero, I understand you had a loss of hydraulic pressure, confirm?",
    expected_confirmation:
      "NEGATIVE, we've had a rapid decompression, not a loss of hydraulic pressure. Descend to FL 090, LEVEL 6.",
  },
  {
    prompt_text: "You have just departed from Ezeiza Airport in Buenos Aires. Listen to Ezeiza Tower and read back.",
    atc_audio_text:
      "LEVEL 6, maintain runway heading, climb to flight level zero seven zero. Expedite climb. Call Buenos Aires Departure on frequency one two five decimal six zero.",
    expected_readback:
      "Ezeiza Tower, roger, maintain runway heading, climb to FL 070, expedite climb, call Buenos Aires Departure on 125.6, LEVEL 6.",
    complication_text:
      "Now, when passing three thousand feet, you see this situation on your weather radar and you decide to deviate to the right. Call Buenos Aires Departure and say your intentions.",
    complication_image_url: publicUrlFor("fixed-wing/part2-situation-4-weather-radar.jpg"),
    expected_reaction: "Buenos Aires Departure, LEVEL 6, we need to deviate to the right due to bad weather.",
    atc_followup_audio_text:
      "LEVEL 6, increase rate of climb until passing flight level zero six zero, confirm you need to deviate to the right due to bad weather.",
    expected_confirmation:
      "AFFIRM. We need to deviate to the right due to bad weather. Increase rate of climb until passing FL 060, LEVEL 6.",
  },
  {
    prompt_text: "You are going to take off from Santos Dumont Airport. Listen to Santos Dumont Clearance and read back.",
    atc_audio_text:
      "LEVEL 6, expect start up at three five and runway two zero left. You are cleared to Confins Airport via Upper Zulu Four, flight level three six zero, PUMSO One Charlie Departure ISRIN transition. Squawk four seven five one. Read back.",
    expected_readback:
      "Rio Approach, cleared to Confins Airport, via UZ4, FL360, PUMSO 1C Departure, ISRIN transition. Squawk 4751.",
    complication_text:
      "Now, after takeoff, this happens to you. Because of this situation, you have decided to divert to Galeao Airport. Call Rio Approach, explain the situation and say your intentions.",
    complication_image_url: publicUrlFor("fixed-wing/part2-situation-5-bird-strike.jpg"),
    expected_reaction: "Rio Approach, LEVEL 6. We have hit a flock of birds. Request diversion to Galeao Airport.",
    atc_followup_audio_text:
      "LEVEL 6, I'll give you priority to land at Santos Dumont Airport. Turn right heading two five zero. Expect visual approach runway two zero left.",
    expected_confirmation: "NEGATIVE, I requested to divert to Galeao Airport, LEVEL 6.",
  },
];

const PART2_ROTARY_WING = [
  // Test 1 Helicopter
  {
    prompt_text: "You are at Juiz de Fora Airport. Listen to Juiz de Fora Tower and read back.",
    atc_audio_text: "LEVEL 6, cleared to enter runway 20 and backtrack. Report ready for takeoff.",
    expected_readback: "We're cleared to enter runway 20 and backtrack. I'll report ready for takeoff, LEVEL 6.",
    complication_text:
      "Now, during taxi, your chief purser advises you that an unaccompanied child is having an epileptic seizure. Contact Tower, report your situation and request medical help.",
    complication_image_url: null,
    expected_reaction:
      "Juiz de Fora Tower, LEVEL 6, there is an unaccompanied child onboard having an epileptic seizure. We need to return to the apron and request an ambulance immediately.",
    atc_followup_audio_text:
      "LEVEL 6, you are cleared to exit the runway by Delta to the parking area. An ambulance will be provided. Confirm if the crew member is female.",
    expected_confirmation:
      "We're cleared to exit the runway by Delta to the parking area. Roger about the ambulance. Negative, there's an unaccompanied child onboard having an epileptic seizure, LEVEL 6.",
  },
  {
    prompt_text: "You have just departed from Athens International Airport. Listen to the ATC and read back.",
    atc_audio_text:
      "LEVEL 6, Athens Control. Squawk IDENT on transponder. Keep runway heading. You are cleared to climb to flight level zero eight zero.",
    expected_readback:
      "Squawk IDENT on transponder. We'll keep the runway heading and we're cleared to climb to flight level 080, LEVEL 6.",
    complication_text:
      "Now, while climbing, you realize your landing gear did not retract fully. Inform this problem to the ATC and request holding to solve this issue.",
    complication_image_url: null,
    expected_reaction:
      "Athens Control, LEVEL 6, our landing gear is not fully retracted. We request holding to try to handle this issue.",
    atc_followup_audio_text:
      "LEVEL 6, I understood you have a problem with your landing gear and you request to hold. Is that right?",
    expected_confirmation:
      "Affirm, our landing gear is not fully retracted. We request holding to try to handle this issue, LEVEL 6.",
  },
  {
    prompt_text: "You are on final approach to land at Dubai Airport. Listen to Dubai Approach and read back.",
    atc_audio_text:
      "LEVEL 6, cleared to descend and maintain seven thousand feet. Fly Sierra position to initiate Beta 2 arrival. Be advised of a flock of birds near threshold.",
    expected_readback:
      "We're cleared to descend and maintain 7,000 ft. We'll fly Sierra position to initiate Beta 2 arrival. We're aware about the flock of birds near the threshold, LEVEL 6.",
    complication_text:
      "Now, while descending, you notice that you lost all your left hydraulic system. And, as a consequence, you will have to use the emergency one to extend the gear. Contact ATC and tell them about your problems and intentions.",
    complication_image_url: null,
    expected_reaction:
      "Dubai Control, LEVEL 6, we lost our left hydraulic system during descent. We'll need to extend the gears using the emergency one. We request ground assistance and a tow truck after landing.",
    atc_followup_audio_text:
      "LEVEL 6, cleared to descend at your discretion. Inform indicated airspeed. Confirm you have lost navigation systems.",
    expected_confirmation:
      "We're cleared to descend at our discretion. Indicated airspeed 240 Kt. Negative, we have lost our left hydraulic system, LEVEL 6.",
  },
  {
    prompt_text: "You are ready to taxi at Ezeiza Airport in Buenos Aires. Listen to Ezeiza Ground and read back.",
    atc_audio_text:
      "LEVEL 6, taxi via Romeo and Alfa to runway zero nine left. You will follow a Cessna Citation approaching holding point. Contact Tower on one one nine decimal two zero.",
    expected_readback:
      "Taxiing via Romeo and Alfa to runway 09 left. We'll follow a Cessna Citation approaching holding point. We'll contact Tower on 119,20, LEVEL 6.",
    complication_text: "Now, while taxiing, you see a dog on the taxiway. Call Ezeiza Ground and say your intentions.",
    complication_image_url: null,
    expected_reaction:
      "Ezeiza Ground, LEVEL 6. We stopped taxiing because there is a dog on the taxiway. We request ground assistance to remove the dog.",
    atc_followup_audio_text:
      "LEVEL 6, maintain position. You said there is a dog by taxiway Romeo. Is that correct? Staff is on the way.",
    expected_confirmation:
      "We're maintaining position. Affirm, we stopped taxiing because there is a dog on the taxiway. We request ground assistance to remove the dog, LEVEL 6.",
  },
  {
    prompt_text: "You have just taken off from Salvador using RNAV. Listen to Salvador Tower and read back.",
    atc_audio_text:
      "LEVEL 6, airborne at 15. Climb to three thousand feet. Fly heading TINO VORTAC. Speed at your discretion.",
    expected_readback: "Airborne at 15. I'll climb to 3,000 ft and fly heading TINO VORTAC. Speed at our discretion, LEVEL 6.",
    complication_text: "Now, after takeoff, you lose your GPS navigation. Call Salvador Control, explain the situation and say your intentions.",
    complication_image_url: null,
    expected_reaction: "Salvador Control, LEVEL 6. We lost our GPS navigation. We need vectors to return to Salvador airport, LEVEL 6.",
    atc_followup_audio_text:
      "LEVEL 6, I understood you had an EGPWS failure. Transmission is poor. Do you hear me loud and clear?",
    expected_confirmation:
      "Negative, we have lost our GPS and we need vectors to return to Salvador airport. We read you 5, LEVEL 6.",
  },
  // Test 2 Helicopter
  {
    prompt_text: "You are going to depart from Atlanta International Airport. Listen to Atlanta Ground and read back all information.",
    atc_audio_text:
      "LEVEL 6, you are cleared to taxi via Bravo and Bravo Charlie to RWY 09 central. Give way to an Airbus 380 leaving Delta 7. Expect 30-minute delay for takeoff. Altimeter setting 1021.",
    expected_readback:
      "Taxiing via Bravo and Bravo Charlie to runway 09 central. We'll give way to an Airbus 380 leaving Delta 7. We'll expect 30-minute delay for takeoff. QNH 1021, LEVEL 6.",
    complication_text:
      "Now, while taxiing, you observe some liquid leaking from the Airbus in front of you. It seems to escape from the landing gear. Report it to the ATC.",
    complication_image_url: null,
    expected_reaction:
      "Atlanta Ground, LEVEL 6, we can see a liquid coming out from the Airbus in front of us. It looks like hydraulic fluid from the landing gear.",
    atc_followup_audio_text: "LEVEL 6, hold position. Confirm you notice hydraulic fluid coming out from your landing gear.",
    expected_confirmation: "We're holding position. Negative, the liquid is coming out from the Airbus A380 ahead of us, LEVEL 6.",
  },
  {
    prompt_text: "You are at Juiz de Fora Airport. Listen to Juiz de Fora Tower and read back.",
    atc_audio_text: "LEVEL 6, cleared to enter runway 20 and backtrack. Report ready for takeoff.",
    expected_readback: "We're cleared to enter runway 20 and backtrack. We'll report ready for takeoff, LEVEL 6.",
    complication_text:
      "Now, during taxi, your chief purser advises you that an unaccompanied minor is having an epileptic seizure. Contact Tower, report your situation and request medical help.",
    complication_image_url: null,
    expected_reaction:
      "Juiz de Fora Tower, LEVEL 6, there is an unaccompanied minor onboard having an epileptic seizure. We need to return to the apron and request an ambulance immediately.",
    atc_followup_audio_text:
      "LEVEL 6, you are cleared to exit the runway by Delta to the parking area. An ambulance will be provided. Confirm if the passenger is under 18.",
    expected_confirmation:
      "We're cleared to exit the runway by Delta to the parking area. Roger about the ambulance. Affirm, there's a child onboard having an epileptic seizure, LEVEL 6.",
  },
  {
    prompt_text: "You are going to land at Bristol Airport. Listen to Bristol Approach and read back all information.",
    atc_audio_text: "LEVEL 6, Bristol Approach. Descend to flight level 140, heading 280 degrees. Altimeter setting 1019.",
    expected_readback: "We'll descend to flight level 140, heading 280. QNH 1019, LEVEL 6.",
    complication_text:
      "Now, Control ordered you to hold over Bristol VOR for more 20 minutes. You've realized you're about to face a fuel shortage. Contact Bristol Approach and inform them about your situation.",
    complication_image_url: null,
    expected_reaction:
      "Bristol Approach, LEVEL 6, we are not able to keep holding. We're about to face a fuel shortage. Request priority to land.",
    atc_followup_audio_text:
      "LEVEL 6, we will give you priority to land. Expect vectors to runway 27 right. Proceed direct to AVEC VOR, flight level 080. Confirm you are running low on fuel.",
    expected_confirmation:
      "Priority to land. We'll expect vectors to runway 27 right and we'll proceed direct to AVEC VOR, flight level 080. Affirm, we are running low on fuel, LEVEL 6.",
  },
  {
    prompt_text: "You are ready to taxi and depart at Boca Raton Airport. Listen to Boca Raton Ground and read back.",
    atc_audio_text:
      "LEVEL 6, cleared to taxi via Romeo and Sierra two to holding point runway one six. You are number six to depart. Read back.",
    expected_readback: "Taxiing via Romeo and Sierra 2 to holding point runway 16. We're number 6 to depart, LEVEL 6.",
    complication_text: "Now, while taxiing to runway 16, you see a drone flying over the taxiway. Report the situation and say intentions.",
    complication_image_url: null,
    expected_reaction: "Boca Raton Ground, LEVEL 6, we are approaching RWY 16 and there's a drone flying over here. Request security services.",
    atc_followup_audio_text:
      "LEVEL 6, stop taxiing. I heard you saying there is a drone near you. Is that correct? We are activating security services.",
    expected_confirmation: "We've stopped taxiing. Affirm. There is a drone flying over here. Roger about security services, LEVEL 6.",
  },
  {
    prompt_text: "You are on final approach to Confins Airport. Listen to the ATC and read back all information.",
    atc_audio_text: "LEVEL 6, continue ILS approach to runway one six followed by circling to runway three four. Report base leg.",
    expected_readback: "We'll continue ILS approach to RWY 16 followed by circling to RWY 34. We'll report on base leg, LEVEL 6.",
    complication_text: "Now, on short final to RWY 34, you see a truck on the runway. Report the situation and say intentions.",
    complication_image_url: null,
    expected_reaction: "Confins Tower, LEVEL 6, we are going around due to a truck on the runway. Request instructions.",
    atc_followup_audio_text:
      "LEVEL 6, climb to three thousand feet. Report upwind leg. I understood you are performing a missed approach due to a runway incursion. Is that right?",
    expected_confirmation:
      "We're climbing to 3,000 feet. We'll report upwind leg. Affirm. We are going around because there is a truck on the runway, LEVEL 6.",
  },
  // Test 3 Helicopter
  {
    prompt_text: "You have just taken off from Curitiba Airport. Listen to Curitiba Tower and read back.",
    atc_audio_text:
      "LEVEL 6, airborne at three zero. Keep runway heading until crossing four thousand feet. Contact Control on one two two decimal five zero.",
    expected_readback: "Airborne at 30. We'll keep runway heading until crossing four thousand feet. We'll contact Control on 122,50, LEVEL 6.",
    complication_text:
      "Now, while climbing, you notice that there is fire in the cockpit. You have followed all the checklist procedures and then you decided to return to Curitiba. Call Control, report your situation and say intentions.",
    complication_image_url: null,
    expected_reaction: "MAYDAY MAYDAY MAYDAY, Curitiba Control, LEVEL 6. Fire in the cockpit. We request immediate return to Curitiba.",
    atc_followup_audio_text:
      "LEVEL 6, you are cleared to descend at your discretion to flight level zero four zero. Turn left heading one eight zero. No traffic in this sector. Confirm your engine is on fire.",
    expected_confirmation:
      "Negative, the fire is in the cabin. We are descending to FL040 at our discretion, turning left heading 180, LEVEL 6.",
  },
  {
    prompt_text: "You have just departed from Athens International Airport. Listen to the ATC and read back.",
    atc_audio_text:
      "LEVEL 6, Athens Control. Squawk IDENT on transponder. Keep runway heading. Climb and maintain four thousand feet, expect eight thousand after Bravo 01 VOR.",
    expected_readback:
      "We'll squawk IDENT on transponder. We'll keep runway heading and we'll climb and maintain 4,000 feet. We'll expect 8,000 after Bravo 01 VOR, LEVEL 6.",
    complication_text:
      "Now, while climbing, you realize your landing gear did not retract fully. Inform this problem to the ATC and request holding to solve this issue.",
    complication_image_url: null,
    expected_reaction: "Athens Control, LEVEL 6, our landing gear did not retract fully. We request holding to try to handle this problem.",
    atc_followup_audio_text: "LEVEL 6, I understood you have a problem with your landing gear and you request to hold. Is that right?",
    expected_confirmation: "Affirm, we request holding to try to handle this problem, LEVEL 6.",
  },
  {
    prompt_text: "You are going to depart from Dubai International Airport. Listen to Dubai Ground and read back all information.",
    atc_audio_text:
      "LEVEL 6, you are cleared to taxi via Bravo and hold short of Charlie. Expect to backtrack to runway 12 left. Standby on Tower frequency on one one nine decimal five zero.",
    expected_readback:
      "Taxiing via Bravo and hold short of Charlie. We'll expect to backtrack to runway 12 left. We'll keep standby on 119,50, LEVEL 6.",
    complication_text:
      "Now, right after takeoff, an annunciator light turns on showing that you have an open door. You also notice that you are losing pressure, and, as a consequence, you must return. Inform Dubai Tower about this situation and say you need to burn or dump some fuel to reduce landing weight.",
    complication_image_url: null,
    expected_reaction:
      "PAN PAN, PAN PAN, PAN PAN, Dubai Tower, LEVEL 6. One of our doors has opened and we are losing pressure. We must return but we need to burn or dump some fuel before landing.",
    atc_followup_audio_text: "LEVEL 6, roger PAN PAN. Squawk 7700. Confirm you are depressurizing. You are cleared to land on runway 30 left.",
    expected_confirmation: "We'll squawk 7700. Affirm, we are losing pressure. Negative, we must burn some fuel before landing, LEVEL 6.",
  },
  {
    prompt_text: "You are under vectoring by Empire Control. Listen to the ATC and read back.",
    atc_audio_text:
      "LEVEL 6, radar contact. Descend to eight thousand feet. Keep present heading. Report reaching ten thousand feet. Expect to land on runway 30.",
    expected_readback:
      "Radar contact. We'll descend to 8,000 feet and keep present heading. We'll report reaching 10,000 feet and expect to land on runway 30, LEVEL 6.",
    complication_text: "Now, during the descent, you see a huge hot air balloon at 12 o'clock position. Call Empire Control, report the situation and ask to deviate.",
    complication_image_url: null,
    expected_reaction: "Empire Control, LEVEL 6, there is a huge hot air balloon at 12 o'clock position. We need to deviate to the left.",
    atc_followup_audio_text: "LEVEL 6, turn left heading 180. Could you confirm there is a balloon at 3 o'clock?",
    expected_confirmation: "Negative, the balloon is ahead of us. We are turning left heading 180, LEVEL 6.",
  },
  {
    prompt_text: "You have just taken off from Salvador using RNAV. Listen to Salvador Control and read back.",
    atc_audio_text:
      "LEVEL 6, airborne at 15. Climb to three thousand feet. Fly heading TINO VORTAC. Speed at your discretion.",
    expected_readback: "We'll climb to 3,000 ft heading TINO VORTAC. Speed at our discretion, LEVEL 6.",
    complication_text: "Now, after takeoff, you lose your GPS navigation. Call Salvador Control, explain the situation and say your intentions.",
    complication_image_url: null,
    expected_reaction: "Salvador Control, LEVEL 6. We lost our GPS navigation. We need vectors to return to Salvador airport. LEVEL 6.",
    atc_followup_audio_text: "LEVEL 6, I understood you had a GPS failure. Transmission is poor. Do you hear me loud and clear?",
    expected_confirmation: "Affirm, we have lost our GPS. We read you 5, LEVEL 6.",
  },
  // Test 4 Helicopter
  {
    prompt_text: "You are approaching Manchester Airport. Listen to the ATC and read back.",
    atc_audio_text: "LEVEL 6, Manchester Approach. Descend to flight level 090. Fly heading Fox Alfa VOR and expect one zero minute hold.",
    expected_readback: "We'll descend to FL 090 heading Fox Alpha VOR and we'll expect one zero minute hold, LEVEL 6.",
    complication_text:
      "Now, during approach, you notice that your left engine oil temperature has increased beyond limits, so you had to shut it down. Contact Approach, report your situation and say intentions.",
    complication_image_url: null,
    expected_reaction:
      "PAN PAN, PAN PAN, PAN PAN, Manchester Approach, LEVEL 6, we've shut down our left engine, due to high oil temperature. We need to land immediately. We request priority to land.",
    atc_followup_audio_text:
      "LEVEL 6, fly straight to Fox Alpha VOR. Expect straight-in approach to runway zero nine. I understood you shut one of your engines due to high oil temperature. Is that right?",
    expected_confirmation:
      "We'll fly straight to Fox Alpha VOR, and we'll expect straight-in approach to runway 09. Affirm, we've shut down our left engine, due to high oil temperature, LEVEL 6.",
  },
  {
    prompt_text: "You have just landed at Lisbon Airport. Visibility is poor. Listen to ATC and read back all information.",
    atc_audio_text: "LEVEL 6, cleared to taxi via Juliet and Kilo Kilo to stand four. Cleared to cross both runways. Report vacated.",
    expected_readback: "Taxi via Juliet and Kilo Kilo to stand 4. We're cleared to cross both runways. We'll report vacated, LEVEL 6.",
    complication_text:
      "Now, during your taxiing, you hit a fire truck and as a consequence you will have to be towed to the hangar. Call Lisbon Ground and inform them about your problem and intentions.",
    complication_image_url: null,
    expected_reaction: "Lisbon Ground, LEVEL 6. Due to poor visibility, we've hit a fire truck. We request a tow truck to be towed to the hangar.",
    atc_followup_audio_text:
      "LEVEL 6, I understood you had a strike with a truck and your helicopter is on fire, could you confirm? Assistance is coming right away.",
    expected_confirmation:
      "Negative, we've hit a fire truck. We request a tow truck to be towed to the hangar. Roger about the assistance, LEVEL 6.",
  },
  {
    prompt_text: "You are approaching Toronto Airport. Listen to Toronto Approach and read back.",
    atc_audio_text: "LEVEL 6, Toronto Control. Descend to six thousand feet and turn left heading one eight zero degrees. Maintain eighty knots.",
    expected_readback: "We'll descend to 6,000 feet and turn left heading 180 degrees. We'll maintain 80 knots, LEVEL 6.",
    complication_text:
      "Now, you spot some hills in front of you, and you suspect ATC has forgotten about you. Contact ATC, explain your situation and ask vectors to Hamilton Airport.",
    complication_image_url: null,
    expected_reaction: "Toronto Control, LEVEL 6, there are some hills ahead of us, and we need to deviate. We request vectors to Hamilton Airport.",
    atc_followup_audio_text: "LEVEL 6, transmission was poor. Turn right heading zero seven zero degrees. Do you want to divert to Pearson Airport?",
    expected_confirmation: "I read you 5 by 5. We'll turn right heading 070 degrees. Negative, we request vectors to return to Hamilton airport, LEVEL 6.",
  },
  {
    prompt_text: "You are under vectoring by Empire Control. Listen to the ATC and read back.",
    atc_audio_text: "LEVEL 6, radar contact. Descend to 8,000 feet. Keep present heading. Report reaching 10,000 feet. Expect to land on runway 30.",
    expected_readback:
      "Radar contact. We'll descend to 8,000 feet and keep the present heading. We'll report reaching 10,000 feet and expect to land on runway 30, LEVEL 6.",
    complication_text: "Now, during the descent, you see a huge hot air balloon on your right, at 2 o'clock. Call Empire Control, report the situation and ask to deviate.",
    complication_image_url: null,
    expected_reaction: "Empire Control, LEVEL 6, there is a huge hot air balloon on our right, at 2 o'clock. We need to deviate to the left.",
    atc_followup_audio_text: "LEVEL 6, turn left heading 180. Could you confirm there is a balloon at 2 o'clock?",
    expected_confirmation: "Affirm, there is a huge hot air balloon on our right, at 2 o'clock. We are turning left heading 180, LEVEL 6.",
  },
  {
    prompt_text: "You are on final approach to Confins Airport. Listen to the ATC and read back all information.",
    atc_audio_text: "LEVEL 6, continue ILS approach to runway one six followed by circling to runway three four. Report base leg.",
    expected_readback: "We'll continue ILS approach to RWY 16 followed by circling to RWY 34. We'll report base leg, LEVEL 6.",
    complication_text: "Now, on short final to runway 34, you see a truck on the runway. Report the situation and say intentions.",
    complication_image_url: null,
    expected_reaction: "Confins Tower, LEVEL 6, we are going around due to a truck on the runway. Request instructions.",
    atc_followup_audio_text:
      "LEVEL 6, turn right, report downwind leg. You are going around because you have problems in the main gear, is that right?",
    expected_confirmation: "We'll turn right and we'll report downwind leg. Negative, we are going around because there is a truck on the runway, LEVEL 6.",
  },
];

// Parte 3 — prompt_text guarda a transcrição do diálogo piloto/controlador
// (narrada como áudio único, o candidato só escuta) e discussion_question é
// a pergunta técnica feita depois do relato.
const PART3_FIXED_WING = [
  {
    prompt_text:
      "Pilot: Miami Center, American 2493, we are now experiencing severe turbulence at flight level three zero zero. A passenger is injured. Request return to Miami. ATC: American 2493, roger. Turn right heading one five and descend to flight level two four zero. Medical assistance will be provided upon arrival.",
    discussion_question: "How can a pilot avoid a bad weather situation when overflying the ocean?",
  },
  {
    prompt_text:
      "Pilot: Dubai Control, Emirates 075. I had a tail strike during takeoff. We need to climb to the minimum safe altitude in order to check our systems before returning. ATC: Emirates 075. Roger. Climb to four thousand feet, maintain radial one two zero, call back for vectors to return.",
    discussion_question: "What kind of emergency or abnormal situations may a pilot experience during takeoff roll?",
  },
  {
    prompt_text:
      "Pilot: Mayday, Mayday, Mayday, Dubai Departure, Skydubai 523. We lost thrust in both engines. We'll try to return to Dubai, but we might need to ditch. ATC: Skydubai 523, roger. Turn left heading two three zero. Expect to land on runway three zero right.",
    discussion_question: "What may happen to a twin-engined aircraft if both engines fail in-flight?",
  },
];

const PART3_ROTARY_WING = [
  {
    prompt_text:
      "ATC: PR-CFT, Brasilia Center. Turn right and fly heading three one zero. There is a restricted area in front of you. A military operations area is activated. Pilot: Brasilia Center, PR-CFT. We are unable to comply with your instruction. There is a massive stormy formation at two o'clock.",
    discussion_question: "Under which circumstances are pilots allowed to disregard ATC instructions? Explain it.",
  },
  {
    prompt_text:
      "Pilot: Toulose Center, PR-CHE. We are facing flight control problems here. We believe it's because of a hydraulic pressure drop. We request emergency landing on your field. ATC: PR-CHE, roger. Descend at your discretion to four thousand feet. Runway one five left is available. Do you need any special assistance upon landing?",
    discussion_question: "What happens if you lose hydraulics? Is it better to go for a full landing or hover?",
  },
  {
    prompt_text:
      "Pilot: Pan Pan, Pan Pan, Pan Pan, Ibiza Approach, PR-CHE, we are performing an emergency landing here due to a transmission oil loss. ATC: PR-CHE, roger. Here on my screen you're near to Alfa one seven position. Confirm position and state landing site. Pilot: Ibiza Approach, we will end up on a farm area southwest position of Malarca.",
    discussion_question: "How does an oil loss from transmission affect a helicopter flight?",
  },
  {
    prompt_text:
      "Pilot: Newark Tower, PT-CFT. We are flying heading 090 at 6,000 ft due to GPS failure. We have an iPad here, but it is also inoperative. We are unable to state estimated time over Bravo 7 VOR. ATC: PT-CFT, Newark Tower, roger. Resume conventional navigation. Intercept 045 radial, outbound Charlie 8 VOR for seven zero nautical miles, then fly direct to Bravo 7.",
    discussion_question: "Is GPS totally reliable as means of navigation? Why?",
  },
  {
    prompt_text:
      "Pilot: Brasilia Center, November one two seven. We heard an unusual sound here, at flight level 070. We have disconnected autopilot and we cannot hold altitude. We need to descend right away to four thousand feet. ATC: N127, Brasilia Center. Roger. You are cleared to descend to four thousand feet.",
    discussion_question: "Why is it needed to disconnect autopilot?",
  },
  {
    prompt_text:
      "Pilot: Mayday, Mayday, Mayday. Santa Fe Approach, PT-CFT, engine failure, we are starting an autorotation here. ATC: PT-CFT, roger. Confirm your position. Pilot: We are over beach line, abeam Las Palmas, CFT. ATC: PT-CFT, report on the ground. Pilot: Wilco, CFT.",
    discussion_question: "Why does a helicopter pilot need to enter an autorotation? How to make it safe?",
  },
  {
    prompt_text:
      "Pilot: Pan Pan, Pan Pan, Pan Pan, Miami Approach, PR-CFT. Bird strike on the blades. We are experiencing high vibration. Request diversion to Fort Lauderdale airport. ATC: PR-CFT, Roger. TMA operating conventional. State your distance from Fort Lauderdale Airport. Pilot: Five miles out, descending to traffic altitude, CFT.",
    discussion_question: "How can you handle high vibration?",
  },
  {
    prompt_text:
      "Pilot: Pan Pan, Pan Pan, Pan Pan. Sao Paulo Approach, PR-CFT. We had an engine failure. We need to return to Guarulhos and highest priority to land. ATC: PR-CFT, roger. Fly straight to Delta VOR. Cleared for November approach runway two seven right.",
    discussion_question: "In your opinion, which aircraft is safer: an airplane or a helicopter? Why?",
  },
  {
    prompt_text:
      "Pilot: Pan Pan, Pan Pan, Pan Pan, Rio Approach, N07CFT. We had a total electrical failure. Request to return immediately. Thirty-minute battery power only. ATC: N07CFT, roger. Turn left and fly heading 090. Expect vectors. You are number two for landing.",
    discussion_question: "Which systems are affected by an electrical failure?",
  },
  {
    prompt_text:
      "Pilot: Bristol Approach, it seems we're going to return to the airport due to an airspeed indicator failure. We need to check it out, PR-CFT. ATC: PR-CFT, roger. Descend to zero nine zero. QNH 1009. Expect vectors to ILS runway one one.",
    discussion_question: "How bad is it when you don't know your correct speed?",
  },
  {
    prompt_text:
      "Pilot: Pan Pan, Pan Pan, Pan Pan. PR-CHE, tail rotor control failure. ATC: PR-CHE, roger. Say intentions. Pilot: Request an available runway for running landing, PR-CHE. ATC: PR-CHE, proceed to Santos Dumont Airport to runway two zero. State estimated time of arrival. Pilot: We estimate landing at one seven, PR-CHE.",
    discussion_question: "What are the possible causes of a tail rotor failure? And how to deal with it?",
  },
  {
    prompt_text:
      "Pilot: Mayday, Mayday, Mayday, London Center, Speedbird 97. We have fire in the cargo hold. We are descending to three thousand feet. Request emergency landing, straight-in approach at Yorkshire Airport. Four hundred liters remaining. ATC: Speedbird 97, roger Mayday. Descend at your discretion. Firefighters will be called upon. Please inform how many souls on board.",
    discussion_question: "What actions should a pilot take in case of fire onboard?",
  },
];

// Parte 4 — pool de fotos IA-geradas fornecido pela Sabrina (13 avião + 10
// helicóptero, ver scripts/upload-pilot-part4-images.mjs). Só a AFIRMAÇÃO
// (agree_disagree_statement) é específica da foto; a descrição, as hipóteses de
// antes/depois e as 2 perguntas de discussão são FIXAS e vivem no runner
// (PART4_* em src/components/sdea/pilot-interview-runner.tsx), conforme
// orientação da Sabrina e o "Modelo SDEA com anotações". Por isso
// discussion_question / discussion_question_2 ficam null aqui.
const PART4_PROMPT_TEXT = "Please describe this picture to me.";

const PART4_FIXED_WING = [
  "An engine fire on the ground is always easier to handle than one that starts in flight.",
  "Airport congestion is a commercial issue and has little effect on flight safety.",
  "Most runway excursions could be prevented if crews were quicker to decide to go around or divert.",
  "With today's weather radar and forecasting, flying into severe weather is entirely the flight crew's responsibility.",
  "Medical flights should always be given priority over commercial traffic, whatever the delay to other aircraft.",
  "In uncontrolled airspace, see-and-avoid alone is not enough to prevent mid-air collisions.",
  "A pilot must always follow a TCAS resolution advisory, even when it goes against an air traffic control instruction.",
  "Reducing the vertical separation between aircraft at cruising level has made busy airspace less safe.",
  "The pressure to keep turnaround times short is one of the main causes of ground handling mistakes.",
  "Any passenger who becomes violent on board should be banned from flying with that airline for life.",
  "A first officer should openly challenge the captain whenever they believe a decision is unsafe, regardless of the captain's seniority.",
  "A commercial flight should divert whenever a passenger becomes seriously ill, no matter the cost to the airline.",
  "A burst tyre detected during the takeoff roll should always lead to a rejected takeoff.",
].map((statement, i) => ({
  prompt_text: PART4_PROMPT_TEXT,
  image_url: part4Url("fixed_wing", i + 1),
  discussion_question: null,
  discussion_question_2: null,
  agree_disagree_statement: statement,
}));

const PART4_ROTARY_WING = [
  "The benefits of helicopter medical services outweigh the extra risks of landing away from proper airfields.",
  "Transferring a critically ill patient between hospitals is safer by helicopter than by road ambulance.",
  "Frequent training exercises matter more than advanced equipment for the success of a rescue operation.",
  "For fighting wildfires, helicopters are more useful than fixed-wing water bombers.",
  "In an air rescue mission, the speed of the response matters more than any other factor.",
  "Firefighting aircraft should stop operating when smoke reduces visibility below safe limits, even if the fire keeps spreading.",
  "Flying close to terrain in poor visibility is an acceptable risk during firefighting operations.",
  "Helicopter mountain rescue should only be carried out by crews with specific mountain training.",
  "During a hoist operation, it is the winch operator, not the pilot, who is effectively in control of the helicopter.",
  "In a rescue at sea, a helicopter is always a better choice than a lifeboat.",
].map((statement, i) => ({
  prompt_text: PART4_PROMPT_TEXT,
  image_url: part4Url("rotary_wing", i + 1),
  discussion_question: null,
  discussion_question_2: null,
  agree_disagree_statement: statement,
}));

const PART2_DURATION = 90;
const PART3_DURATION = 90;
const PART4_DURATION = 90;

async function upsertPart1(client, text) {
  const { rows } = await client.query(
    `update public.pilot_prompts
       set expected_duration_seconds = 60, is_active = true
     where part = 'part1' and aircraft_type = 'general' and prompt_text = $1
     returning id`,
    [text],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts (part, aircraft_type, prompt_text, expected_duration_seconds, is_active)
     values ('part1', 'general', $1, 60, true)
     returning id`,
    [text],
  );
  return inserted.rows[0].id;
}

async function upsertPart2(client, aircraftType, orderIndex, item) {
  const values = [
    item.prompt_text,
    item.atc_audio_text,
    item.expected_readback,
    item.complication_text,
    item.complication_image_url,
    item.expected_reaction,
    item.atc_followup_audio_text,
    item.expected_confirmation,
    PART2_DURATION,
    aircraftType,
    orderIndex,
  ];
  const { rows } = await client.query(
    `update public.pilot_prompts
       set prompt_text = $1, atc_audio_text = $2, expected_readback = $3, complication_text = $4,
           complication_image_url = $5, expected_reaction = $6, atc_followup_audio_text = $7,
           expected_confirmation = $8, expected_duration_seconds = $9, is_active = true
     where part = 'part2' and aircraft_type = $10 and order_index = $11
     returning id`,
    values,
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts
       (part, aircraft_type, order_index, prompt_text, atc_audio_text, expected_readback, complication_text,
        complication_image_url, expected_reaction, atc_followup_audio_text, expected_confirmation,
        expected_duration_seconds, is_active)
     values ('part2', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
     returning id`,
    [
      aircraftType,
      orderIndex,
      item.prompt_text,
      item.atc_audio_text,
      item.expected_readback,
      item.complication_text,
      item.complication_image_url,
      item.expected_reaction,
      item.atc_followup_audio_text,
      item.expected_confirmation,
      PART2_DURATION,
    ],
  );
  return inserted.rows[0].id;
}

async function upsertPart3(client, aircraftType, orderIndex, item) {
  const { rows } = await client.query(
    `update public.pilot_prompts
       set prompt_text = $1, discussion_question = $2, expected_duration_seconds = $3, is_active = true
     where part = 'part3' and aircraft_type = $4 and order_index = $5
     returning id`,
    [item.prompt_text, item.discussion_question, PART3_DURATION, aircraftType, orderIndex],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts
       (part, aircraft_type, order_index, prompt_text, discussion_question, expected_duration_seconds, is_active)
     values ('part3', $1, $2, $3, $4, $5, true)
     returning id`,
    [aircraftType, orderIndex, item.prompt_text, item.discussion_question, PART3_DURATION],
  );
  return inserted.rows[0].id;
}

async function upsertPart4(client, aircraftType, orderIndex, item) {
  const { rows } = await client.query(
    `update public.pilot_prompts
       set prompt_text = $1, discussion_question = $2, discussion_question_2 = $3,
           agree_disagree_statement = $4, expected_duration_seconds = $5, order_index = $6,
           is_active = true
     where part = 'part4' and aircraft_type = $7 and image_url = $8
     returning id`,
    [
      item.prompt_text,
      item.discussion_question,
      item.discussion_question_2,
      item.agree_disagree_statement,
      PART4_DURATION,
      orderIndex,
      aircraftType,
      item.image_url,
    ],
  );
  if (rows.length > 0) return rows[0].id;
  const inserted = await client.query(
    `insert into public.pilot_prompts
       (part, aircraft_type, order_index, image_url, prompt_text, discussion_question,
        discussion_question_2, agree_disagree_statement, expected_duration_seconds, is_active)
     values ('part4', $1, $2, $3, $4, $5, $6, $7, $8, true)
     returning id`,
    [
      aircraftType,
      orderIndex,
      item.image_url,
      item.prompt_text,
      item.discussion_question,
      item.discussion_question_2,
      item.agree_disagree_statement,
      PART4_DURATION,
    ],
  );
  return inserted.rows[0].id;
}

async function deactivateStale(client, part, aircraftType, keptIds) {
  await client.query(
    `update public.pilot_prompts
       set is_active = false
     where part = $1 and aircraft_type = $2 and not (id = any($3::uuid[]))`,
    [part, aircraftType, keptIds],
  );
}

async function main() {
  const env = loadEnv();
  const client = new Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();

  const part1Ids = [];
  for (const text of PART1) {
    part1Ids.push(await upsertPart1(client, text));
  }
  await deactivateStale(client, "part1", "general", part1Ids);

  const part2FixedIds = [];
  for (let i = 0; i < PART2_FIXED_WING.length; i++) {
    part2FixedIds.push(await upsertPart2(client, "fixed_wing", i + 1, PART2_FIXED_WING[i]));
  }
  await deactivateStale(client, "part2", "fixed_wing", part2FixedIds);

  const part2RotaryIds = [];
  for (let i = 0; i < PART2_ROTARY_WING.length; i++) {
    part2RotaryIds.push(await upsertPart2(client, "rotary_wing", i + 1, PART2_ROTARY_WING[i]));
  }
  await deactivateStale(client, "part2", "rotary_wing", part2RotaryIds);

  const part3FixedIds = [];
  for (let i = 0; i < PART3_FIXED_WING.length; i++) {
    part3FixedIds.push(await upsertPart3(client, "fixed_wing", i + 1, PART3_FIXED_WING[i]));
  }
  await deactivateStale(client, "part3", "fixed_wing", part3FixedIds);

  const part3RotaryIds = [];
  for (let i = 0; i < PART3_ROTARY_WING.length; i++) {
    part3RotaryIds.push(await upsertPart3(client, "rotary_wing", i + 1, PART3_ROTARY_WING[i]));
  }
  await deactivateStale(client, "part3", "rotary_wing", part3RotaryIds);

  const part4FixedIds = [];
  for (let i = 0; i < PART4_FIXED_WING.length; i++) {
    part4FixedIds.push(await upsertPart4(client, "fixed_wing", i + 1, PART4_FIXED_WING[i]));
  }
  await deactivateStale(client, "part4", "fixed_wing", part4FixedIds);

  const part4RotaryIds = [];
  for (let i = 0; i < PART4_ROTARY_WING.length; i++) {
    part4RotaryIds.push(await upsertPart4(client, "rotary_wing", i + 1, PART4_ROTARY_WING[i]));
  }
  await deactivateStale(client, "part4", "rotary_wing", part4RotaryIds);

  console.log(
    `Seed concluído: ${PART1.length} Parte 1 (general), ${part2FixedIds.length} Parte 2 fixed_wing, ` +
      `${part2RotaryIds.length} Parte 2 rotary_wing, ${part3FixedIds.length} Parte 3 fixed_wing, ` +
      `${part3RotaryIds.length} Parte 3 rotary_wing, ${part4FixedIds.length} Parte 4 fixed_wing, ` +
      `${part4RotaryIds.length} Parte 4 rotary_wing.`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
