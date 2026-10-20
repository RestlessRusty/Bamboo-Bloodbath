import { EMBER_WOODS, FIREFLY_FEN, FROSTBITE_RIDGE, RESEARCH_STATION, WILLOW_RIVER } from '../maps/story';
import type { Chapter } from './types';

/**
 * "Find the Cure": the story campaign. Each chapter is one map with a list of objectives done in
 * order. Every objective has a HUD label, so the dialogue and the cards can be skipped freely.
 */
export const CHAPTERS: readonly Chapter[] = [
  // ------------------------------------------------------------------ 1
  {
    title: 'The Signal',
    blurb: 'Fix the old ranger radio and find out who is calling.',
    map: EMBER_WOODS,
    art: 'radio',
    timeLimit: null,
    horde: { base: 6, perSurvivor: 5, progressBonus: 0.4, max: 30 },
    sleepShare: 0.7,
    stages: [
      {
        kind: 'reach',
        label: "Reach the ranger's radio cabin",
        at: { x: -8, z: 10 },
        r: 6,
        say: [
          { who: 'you', text: 'That crackle last night came from the ranger cabin. Somebody is out there.' },
          { who: 'buddy', text: 'Or something. Let’s tiptoe past the snorers.' },
        ],
      },
      {
        kind: 'collect',
        label: 'Find batteries for the radio',
        item: 'battery',
        spots: [
          { x: 52, z: 52 },
          { x: -58, z: -12 },
          { x: 38, z: -36 },
        ],
        checkpoint: { x: -12, z: 16 },
        say: [
          { who: 'you', text: 'Dead as a doornail. Needs batteries.' },
          { who: 'buddy', text: 'The rangers hid spares all over the woods. Follow the arrow!' },
        ],
      },
      {
        kind: 'reach',
        label: 'Bring the batteries back to the radio',
        at: { x: -8, z: 10 },
        r: 6,
        say: [{ who: 'you', text: 'That’s all three. Back to the radio!' }],
        done: [
          { who: 'radio', text: '…kssh… anyone? This is Doc Mapo at the river clinic!' },
          { who: 'radio', text: 'I found notes on a CURE. At the old research station, past the mountains.' },
          { who: 'radio', text: 'But I’m stuck. Zombies everywhere. Please hurry… kssh.' },
        ],
      },
      {
        kind: 'reach',
        label: 'Take the trail north-east, towards the river clinic',
        at: { x: 72, z: -72 },
        r: 5,
        checkpoint: { x: -12, z: 16 },
        say: [{ who: 'you', text: 'A cure! Hold on, Doc. We’re coming.' }],
      },
    ],
    intro: [
      { title: 'Chapter 1: The Signal', text: 'Three weeks ago the bamboo went bad. Ever since, the neighbours have been groaning instead of saying hello.' },
      { text: 'Last night the old ranger radio crackled. Somebody out there is still talking.' },
      { text: 'Time to find out who. Quietly: half the woods are napping.' },
    ],
    outro: [
      { title: 'A voice on the radio', text: 'Doc Mapo, a medic, is holed up at the river clinic. She says there’s a cure. A real one.' },
      { text: 'You pack a snack and set off. It’s a long walk.' },
    ],
  },

  // ------------------------------------------------------------------ 2
  {
    title: 'House Call',
    blurb: 'Rescue Doc Mapo from the riverside clinic.',
    map: WILLOW_RIVER,
    art: 'clinic',
    timeLimit: null,
    horde: { base: 8, perSurvivor: 6, progressBonus: 0.5, max: 40 },
    sleepShare: 0.5,
    doc: { spawn: { x: -40, z: -2 } },
    stages: [
      {
        kind: 'reach',
        label: 'Find Doc at the river clinic (across the water, west)',
        at: { x: -40, z: 0 },
        r: 8,
        doc: 'wait',
        say: [
          { who: 'you', text: 'The clinic is across the river. Zombies can’t swim… but I can. Slowly.' },
          { who: 'buddy', text: 'There’s a bridge right by camp. Just saying.' },
        ],
        done: [
          { who: 'doc', text: 'Real live pandas! Not even a little bit zombie? Wonderful!' },
          { who: 'doc', text: 'Keep them off me while I pack the cure notes. Two minutes. Ish.' },
        ],
      },
      {
        kind: 'hold',
        label: 'Keep the zombies off the clinic while Doc packs',
        at: { x: -40, z: 0 },
        r: 11,
        time: 45,
        waveEvery: 7,
        waveSize: 2,
        checkpoint: { x: -40, z: 6 },
        cues: [
          { at: 0.5, line: { who: 'doc', text: 'Bandages, notes, snacks… where is my lucky spoon?' } },
          { at: 0.9, line: { who: 'doc', text: 'Found it! Almost done!' } },
        ],
        done: [{ who: 'doc', text: 'Got everything! Lead the way. I’ll patch you up whenever it’s quiet.' }],
      },
      {
        kind: 'reach',
        label: 'Escort Doc to the trail hut (north-west)',
        at: { x: -72, z: -72 },
        r: 5,
        doc: 'follow',
        checkpoint: { x: -40, z: 6 },
        say: [{ who: 'doc', text: 'Stay close. If I go down, pick me up. If I turn… well, no cure.' }],
      },
    ],
    intro: [
      { title: 'Chapter 2: House Call', text: 'The river clinic sits on the far bank. Zombies can’t swim, which is the only nice thing about them.' },
      { text: 'Somewhere inside is Doc Mapo, the only panda who knows where the cure is.' },
    ],
    outro: [
      { title: 'The notes', text: 'Doc’s notes point to the old research station, high beyond the mountains.' },
      { text: 'Ingredients needed: snow lotus, glowcap mushrooms, and “a large cauldron, ideally clean.”' },
    ],
  },

  // ------------------------------------------------------------------ 3
  {
    title: 'Over the Mountains',
    blurb: 'Pick snow lotus on Frostbite Ridge before the blizzard hits.',
    map: FROSTBITE_RIDGE,
    art: 'mountain',
    timeLimit: 600,
    horde: { base: 9, perSurvivor: 6, progressBonus: 0.5, max: 45 },
    sleepShare: 0.6,
    doc: { spawn: { x: 66, z: 70 } },
    stages: [
      {
        kind: 'collect',
        label: 'Pick snow lotus on the south slopes',
        item: 'lotus',
        spots: [
          { x: -45, z: 42 },
          { x: 8, z: 62 },
        ],
        doc: 'follow',
        say: [
          { who: 'doc', text: 'Snow lotus! The cure needs four. Two grow on this side of the ridge.' },
          { who: 'you', text: 'And the blizzard?' },
          { who: 'doc', text: 'Ten minutes, give or take. Mostly take.' },
        ],
      },
      {
        kind: 'reach',
        label: 'Cross the ridge to the old signpost',
        at: { x: 0, z: -16 },
        r: 7,
        say: [{ who: 'doc', text: 'The wide pass is in the middle. There’s a crack in the west too, if you don’t mind squeezing.' }],
        done: [{ who: 'doc', text: 'Lovely view. Terrible zombies.' }],
      },
      {
        kind: 'collect',
        label: 'Pick snow lotus on the north slopes',
        item: 'lotus',
        spots: [
          { x: -10, z: -32 },
          { x: 55, z: -30 },
        ],
        checkpoint: { x: 0, z: -16 },
        say: [{ who: 'doc', text: 'Two more. My paws are freezing.' }],
      },
      {
        kind: 'reach',
        label: 'Get Doc to the mountain hut before the blizzard',
        at: { x: -72, z: -72 },
        r: 5,
        say: [
          { who: 'buddy', text: 'Is it just me or is it getting… snowier?' },
          { who: 'doc', text: 'Hut! North-west! Run! Not too fast, I’m old.' },
        ],
      },
    ],
    intro: [
      { title: 'Chapter 3: Over the Mountains', text: 'The only way to the station is over Frostbite Ridge. A blizzard is rolling in.' },
      { text: 'Doc insists on stopping for flowers.' },
    ],
    outro: [
      { title: 'Snow lotus: check', text: 'Four snow lotuses, two frozen paws, zero complaints. Out loud.' },
      { text: 'Next: the fen, where glowcaps grow and nobody goes after dark.' },
    ],
  },

  // ------------------------------------------------------------------ 4
  {
    title: 'Glowcaps',
    blurb: 'Hide Doc in the fen and gather glowing mushrooms.',
    map: FIREFLY_FEN,
    art: 'fen',
    timeLimit: null,
    horde: { base: 9, perSurvivor: 7, progressBonus: 0.5, max: 50 },
    sleepShare: 0.75,
    doc: { spawn: { x: -70, z: -68 } },
    stages: [
      {
        kind: 'reach',
        label: 'Get Doc to the big bamboo thicket in the middle',
        at: { x: 0, z: 0 },
        r: 7,
        doc: 'follow',
        say: [
          { who: 'doc', text: 'Glowcaps grow by the ponds. I’ll hide in that big bamboo patch while you pick.' },
          { who: 'doc', text: 'Zombies can barely see you in bamboo. Barely.' },
        ],
      },
      {
        kind: 'collect',
        label: 'Collect glowcaps from the pond shores',
        item: 'glowcap',
        spots: [
          { x: -5.5, z: -52 },
          { x: 40, z: -22.5 },
          { x: -44, z: 37.5 },
          { x: 36, z: 44 },
        ],
        doc: 'wait',
        docPost: { x: 0, z: 0 },
        checkpoint: { x: 6, z: 10 },
        say: [{ who: 'doc', text: 'Four glowcaps, please. And don’t lick them.' }],
      },
      {
        kind: 'reach',
        label: 'Go back to Doc in the thicket',
        at: { x: 0, z: 0 },
        r: 6,
        say: [{ who: 'you', text: 'Got them all. Not licked. Much.' }],
        done: [{ who: 'doc', text: 'Perfect specimens! Slightly licked. I’ll pretend I didn’t see that.' }],
      },
      {
        kind: 'reach',
        label: 'Escort Doc to the boathouse (south-east)',
        at: { x: 74, z: 72 },
        r: 5,
        doc: 'follow',
        checkpoint: { x: 6, z: 10 },
        say: [{ who: 'buddy', text: 'Everyone woke up. Everyone.' }],
      },
    ],
    intro: [
      { title: 'Chapter 4: Glowcaps', text: 'Firefly Fen. Pretty lights, deep water, and a lot of zombies napping in the reeds.' },
      { text: 'Tread softly. Deep water is your friend: zombies can’t swim.' },
    ],
    outro: [
      { title: 'Nearly there', text: 'Glowcaps: check. Lotus: check. Large cauldron: hopefully still at the station.' },
      { text: 'One last walk.' },
    ],
  },

  // ------------------------------------------------------------------ 5
  {
    title: 'The Brew',
    blurb: 'Get Doc to the station and hold the yard while the cure brews.',
    map: RESEARCH_STATION,
    art: 'lab',
    timeLimit: null,
    // Lighter roaming horde: the hold-out waves on top of it are the real fight.
    horde: { base: 8, perSurvivor: 5, progressBonus: 0.5, max: 40 },
    sleepShare: 0.45,
    doc: { spawn: { x: 0, z: 72 } },
    stages: [
      {
        kind: 'reach',
        label: 'Escort Doc through the gate to the research station',
        at: { x: 0, z: -50 },
        r: 8,
        doc: 'follow',
        say: [
          { who: 'doc', text: 'There it is! The old research station, behind the ridge. The gate is straight ahead.' },
          { who: 'buddy', text: 'Big gate. Lots of zombies. Love that for us.' },
        ],
        done: [
          { who: 'doc', text: 'The cauldron’s still here! Ingredients in… and now we wait.' },
          { who: 'doc', text: 'Brewing smells like dumplings. Every zombie for miles is going to come and sniff.' },
        ],
      },
      {
        kind: 'hold',
        label: 'Hold the station yard while the cure brews',
        at: { x: 0, z: -50 },
        r: 13,
        time: 150,
        waveEvery: 7,
        waveSize: 2,
        doc: 'wait',
        docPost: { x: 0, z: -58 },
        checkpoint: { x: 0, z: -44 },
        cues: [
          { at: 0.25, line: { who: 'doc', text: 'It’s bubbling!' } },
          { at: 0.5, line: { who: 'doc', text: 'Halfway! Is it supposed to be purple?' } },
          { at: 0.7, line: { who: 'buddy', text: 'They just keep coming!' } },
          { at: 0.9, line: { who: 'doc', text: 'Almost… almost…' } },
        ],
        done: [{ who: 'doc', text: 'IT’S DONE! Everybody take a deep breath!' }],
      },
    ],
    intro: [
      { title: 'Chapter 5: The Brew', text: 'The old research station. Doc needs a few minutes at the cauldron.' },
      { text: 'The zombies will smell it from miles away. Of course they will.' },
    ],
    outro: [
      { title: 'The cure', text: 'The cure works! One whiff and zombie pandas turn back into regular pandas.' },
      { text: 'Regular, extremely hungry pandas who haven’t eaten in weeks.' },
      { text: 'The pandas are saved. The bamboo, less so.' },
      { title: 'The End', text: 'Thanks for playing, {you}!', art: 'end' },
    ],
  },
];
