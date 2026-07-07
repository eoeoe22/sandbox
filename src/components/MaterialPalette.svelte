<script lang="ts">
  // Alias the `$`-prefixed atom to a plain name so Svelte's `$store`
  // auto-subscription (`$selected`) resolves to it correctly.
  import { $selectedMaterial as selected, $tool as tool } from '../state/store';
  import { MATERIALS } from '../game/materials';
  import { toCss } from '../game/render/color';

  // Picking a material is also a request to paint it, so snap out of any
  // special brush (heat/cool/mix) back to material mode.
  function pick(id: number): void {
    selected.set(id);
    tool.set('material');
  }
</script>

<div class="palette">
  {#each MATERIALS as m (m.id)}
    <button
      class:active={$selected === m.id && $tool === 'material'}
      onclick={() => pick(m.id)}
      title={m.name}
    >
      <span class="swatch" style={`background:${toCss(m.color)}`}></span>
      {m.name}
    </button>
  {/each}
</div>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  button:hover {
    border-color: #3a3a46;
  }
  button.active {
    border-color: #6ea8fe;
    background: #232b3a;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    flex: none;
  }
</style>
