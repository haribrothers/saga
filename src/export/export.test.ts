import { describe, it, expect } from 'vitest';
import type { EpicWithStories } from './format-helpers';
import { exportMarkdown } from './export-markdown';
import { exportDocx } from './export-docx';
import { exportXlsx } from './export-xlsx';
import type { Epic, Story } from '../schema';

function makeEpic(overrides: Partial<Epic> = {}): Epic {
    return {
        id: 'EPIC-001',
        type: 'epic',
        title: 'Checkout',
        description: 'Everything checkout related.',
        status: 'active',
        labels: ['payments'],
        ...overrides,
    };
}

function makeStory(overrides: Partial<Story> = {}): Story {
    return {
        id: 'STORY-001',
        type: 'story',
        title: 'Guest checkout',
        epic: 'EPIC-001',
        status: 'ready',
        as_a: 'shopper',
        i_want: 'to check out without an account',
        so_that: 'I can buy quickly',
        acceptance_criteria: ['Scenario: happy path\n  Given a cart\n  When I check out\n  Then I see a confirmation'],
        estimate: 3,
        labels: ['checkout'],
        subtasks: [
            { id: 'SUB-001', title: 'Add guest session', type: 'task', done: true },
            { id: 'SUB-002', title: 'Write tests', type: 'test', done: false },
        ],
        invest: {
            independent: { result: 'pass', reason: '' },
            negotiable: { result: 'pass', reason: '' },
            valuable: { result: 'pass', reason: '' },
            estimable: { result: 'pass', reason: '' },
            small: { result: 'warn', reason: 'a bit large' },
            testable: { result: 'pass', reason: '' },
        },
        ...overrides,
    };
}

const fixture: EpicWithStories[] = [
    { epic: makeEpic(), stories: [makeStory()] },
    { epic: makeEpic({ id: 'EPIC-002', title: 'Empty epic', labels: [] }), stories: [] },
];

describe('exportMarkdown', () => {
    it('renders epic and story hierarchy with INVEST and subtasks', () => {
        const md = exportMarkdown(fixture);
        expect(md).toContain('# EPIC-001: Checkout');
        expect(md).toContain('## STORY-001: Guest checkout');
        expect(md).toContain('As a shopper, I want to check out without an account, so that I can buy quickly.');
        expect(md).toContain('### SUB-001: Add guest session');
        expect(md).toContain('# EPIC-002: Empty epic');
        expect(md).toContain('```gherkin');
    });
});

describe('exportDocx', () => {
    it('produces a non-empty .docx buffer', async () => {
        const buffer = await exportDocx(fixture);
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
        // .docx is a zip archive — starts with the PK magic number.
        expect(buffer[0]).toBe(0x50);
        expect(buffer[1]).toBe(0x4b);
    });
});

describe('exportXlsx', () => {
    it('produces a non-empty .xlsx buffer', async () => {
        const buffer = await exportXlsx(fixture);
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
        // .xlsx is also a zip archive.
        expect(buffer[0]).toBe(0x50);
        expect(buffer[1]).toBe(0x4b);
    });

    it('handles an epic with no stories without crashing', async () => {
        const buffer = await exportXlsx([{ epic: makeEpic({ id: 'EPIC-003' }), stories: [] }]);
        expect(buffer.length).toBeGreaterThan(0);
    });
});
