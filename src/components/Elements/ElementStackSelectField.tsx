import React from "react";
import { Observable, combineLatest, map } from "rxjs";
import { pick } from "lodash";
import { useDrop } from "react-dnd";

import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  CircularProgress,
  InputAdornment,
  SxProps,
  createFilterOptions,
  FilterOptionsState,
  Paper,
  Stack,
  Chip,
} from "@mui/material";

import { observeAllMap } from "@/observables";

import { ElementStackDraggable } from "@/draggables/element-stack";

import { ElementStackModel } from "@/services/sh-game";

import { useObservation } from "@/hooks/use-observation";

import AspectsList from "../Aspects/AspectsList";

import ElementStackDetails from "./ElementStackDetails";
import ElementIcon from "./ElementIcon";
import Tooltip from "../Tooltip";

export interface ElementStackSelectFieldProps {
  sx?: SxProps;
  label?: string;
  helperText?: React.ReactNode;
  fullWidth?: boolean;
  elementStacks$: Observable<readonly ElementStackModel[]>;
  requireExterior?: boolean;
  displayAspects?: readonly string[];
  value: ElementStackModel | null;
  readOnly?: boolean;
  autoFocus?: boolean;
  onChange(value: ElementStackModel | null): void;
}

interface ElementStackAutocompleteItem {
  label: string | null;
  elementStack: ElementStackModel;
  exterior: boolean;
}

interface ElementStackAutocompleteGroupItem {
  label: string;
  representative: ElementStackModel;
  instances: ElementStackModel[];
  count: number;
  exterior: boolean;
}

function observeAutocompleteItem(
  model: ElementStackModel,
): Observable<ElementStackAutocompleteItem> {
  return combineLatest([model.label$, model.inExteriorSphere$]).pipe(
    map(([label, exterior]) => ({
      label,
      elementStack: model,
      exterior,
    })),
  );
}

function groupAutocompleteItemsFromStacks(
  stacks: readonly ElementStackModel[],
): ElementStackAutocompleteGroupItem[] {
  const groups = new Map<string, ElementStackModel[]>();

  for (const stack of stacks) {
    if (stack.label == null) {
      continue;
    }
    const elementId = stack.elementId;
    const existing = groups.get(elementId);
    if (existing) {
      existing.push(stack);
    } else {
      groups.set(elementId, [stack]);
    }
  }

  const result: ElementStackAutocompleteGroupItem[] = [];
  for (const groupItems of groups.values()) {
    const representativeItem = groupItems[0];
    const baseLabel = representativeItem.label ?? "";
    // Only sum quantities from stacks that are in the exterior sphere (on the board),
    // not those inside verb/situation spheres that are "being used"
    const availableStacks = groupItems.filter((g) => g.inExteriorSphere);
    // Sum the quantity across all available/exterior stacks in this group
    const totalQuantity = availableStacks.reduce(
      (sum, g) => sum + g.quantity,
      0,
    );

    result.push({
      label: baseLabel,
      representative: representativeItem,
      instances: groupItems.map((g) => g),
      count: totalQuantity,
      exterior: groupItems.some((g) => g.inExteriorSphere),
    });
  }

  return result;
}

const defaultFilterOptions =
  createFilterOptions<ElementStackAutocompleteGroupItem>({});

const ElementStackSelectField = ({
  sx,
  label,
  helperText,
  fullWidth,
  elementStacks$,
  requireExterior = false,
  displayAspects,
  value,
  readOnly,
  autoFocus,
  onChange,
}: ElementStackSelectFieldProps) => {
  let items =
    useObservation(
      () => elementStacks$.pipe(observeAllMap(observeAutocompleteItem)),
      [elementStacks$],
    ) ?? null;

  // Raw element stacks — used for accurate grouping/counting (avoids partial array issues from mapArrayItemsCached)
  const rawElementStacks$ =
    useObservation(() => elementStacks$, [elementStacks$]) ?? null;

  // Group items by elementId using raw stacks for accurate counts
  // Use items for reactive label$/exterior$ values, and raw stacks for grouping/instances
  const groupedItems = React.useMemo(() => {
    if (!rawElementStacks$) {
      return [];
    }

    return groupAutocompleteItemsFromStacks(rawElementStacks$);
  }, [rawElementStacks$]);

  const [{ canDrop, isOver, dropElementStack }, drop] = useDrop(
    () => ({
      accept: ElementStackDraggable,
      canDrop: (draggable: ElementStackDraggable) => {
        // Find the group that contains this specific elementStack
        const group = groupedItems?.find((g) =>
          g.instances.includes(draggable.elementStack),
        );
        if (!group) {
          return false;
        }

        // Check if the specific item being dropped is in exterior sphere
        if (requireExterior && !draggable.elementStack.inExteriorSphere) {
          return false;
        }

        return true;
      },
      drop: (item: ElementStackDraggable, monitor) => {
        if (!monitor.canDrop()) {
          return;
        }

        onChange(item.elementStack);
      },
      collect: (monitor) => ({
        canDrop: monitor.canDrop(),
        isOver: monitor.isOver(),
        dropElementStack:
          monitor.getItem<ElementStackDraggable>()?.elementStack,
      }),
    }),
    [groupedItems, requireExterior],
  );

  const [matchCount, setMatchCount] = React.useState(0);
  const filterOptions = React.useCallback(
    (
      options: ElementStackAutocompleteGroupItem[],
      state: FilterOptionsState<ElementStackAutocompleteGroupItem>,
    ) => {
      const result = defaultFilterOptions(options, state);
      setMatchCount(result.length);
      return result.slice(0, 24);
    },
    [],
  );

  const PaperComponent = React.useMemo(
    () =>
      ({ children }: React.HTMLAttributes<HTMLElement>) => (
        <Paper>
          {children}
          {matchCount > 25 && (
            <Stack sx={{ width: "100%", p: 1 }} alignItems="center">
              <Typography
                sx={{ mx: "auto" }}
                textAlign="center"
                variant="caption"
              >
                Showing 25 of {matchCount} matching cards. Use search to refine
                the results.
              </Typography>
            </Stack>
          )}
        </Paper>
      ),
    [matchCount, groupedItems],
  );

  if (!groupedItems) {
    return <CircularProgress color="inherit" />;
  }

  let selectedValue =
    groupedItems.find(({ representative }) => representative === value) ?? null;

  if (canDrop && isOver && dropElementStack) {
    selectedValue =
      groupedItems.find(
        ({ representative }) => representative === dropElementStack,
      ) ?? null;
  }

  const selectedElementId = selectedValue?.representative.elementId ?? null;

  return (
    <Autocomplete
      sx={sx}
      fullWidth={fullWidth}
      options={groupedItems}
      filterOptions={filterOptions}
      readOnly={readOnly}
      autoHighlight
      getOptionLabel={(option) => option.label}
      getOptionDisabled={(option) => requireExterior && !option.exterior}
      value={selectedValue}
      onChange={(_, value) => onChange(value?.representative ?? null)}
      slotProps={{
        // Neither of these have titles, and NVDA reads both.
        // Not sure about other screen readers
        clearIndicator: { "aria-label": "" },
        popupIndicator: { "aria-label": "" },
      }}
      renderInput={(params) => (
        <TextField
          ref={drop}
          {...params}
          sx={{
            ["& .MuiOutlinedInput-root"]: {
              ["& fieldset"]: {
                ...(canDrop && {
                  borderColor: "primary.main",
                }),
              },
            },
          }}
          autoFocus={autoFocus}
          label={label}
          slotProps={{
            // Hack: Orchestration slots need to put divs in helperText, and FormHelperText defaults to a p tag
            // FIXME: We should accept the requirements data ourselves and render it in a standard way
            // rather than having it passed in as helperText.
            // This would be useful to reuse for unlock dialog.
            formHelperText: { component: "div" },
            input: {
              ...params.InputProps,
              startAdornment: (
                <InputAdornment position="start" aria-hidden="true">
                  <Box
                    sx={{
                      display: "flex",
                      height: "100%",
                      width: "30px",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {selectedElementId && (
                      <ElementIcon
                        maxWidth={30}
                        maxHeight={30}
                        elementId={selectedElementId}
                      />
                    )}
                  </Box>
                </InputAdornment>
              ),
            },
          }}
          helperText={helperText}
        />
      )}
      renderOption={(props, option) => (
        <ElementStackSelectItem
          key={option.representative.id}
          props={props}
          displayAspects={displayAspects}
          {...option}
        />
      )}
      PaperComponent={PaperComponent}
    />
  );
};

export default ElementStackSelectField;

interface ElementStackSelectItemProps
  extends ElementStackAutocompleteGroupItem {
  props: any;
  displayAspects?: readonly string[];
}

const ElementStackSelectItem = ({
  props,
  label,
  representative,
  count,
  displayAspects,
}: ElementStackSelectItemProps) => {
  const aspects = useObservation(representative.aspects$);
  const iconUrl = useObservation(representative.iconUrl$);

  if (!label || !aspects) {
    return null;
  }

  const selectedAspects = displayAspects
    ? pick(aspects, displayAspects)
    : aspects;

  return (
    <Box component="li" sx={{ width: "100%" }} {...props}>
      <Tooltip
        sx={{ display: "flex", flexDirection: "row", gap: 1, width: "100%" }}
        title={<ElementStackDetails elementStack={representative} />}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            gap: 2,
            alignItems: "center",
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              width: "30px",
              height: "30px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              aria-hidden="true"
              loading="lazy"
              src={iconUrl}
              style={{
                display: "block",
                maxWidth: "30px",
                maxHeight: "30px",
              }}
            />
          </Box>
          <Typography
            variant="body1"
            sx={{ flex: "1 1", textOverflow: "ellipsis", minWidth: 0 }}
          >
            {label}
          </Typography>
          {count > 1 && (
            <Chip
              size="small"
              label={count}
              sx={{
                minWidth: 24,
                height: 24,
                fontSize: "0.75rem",
                fontWeight: "bold",
              }}
              color="primary"
              variant="outlined"
            />
          )}
        </Box>
        <Box
          sx={{
            ml: "auto",
            display: "flex",
            flexDirection: "row",
            gap: 1,
          }}
        >
          <AspectsList
            sx={{ flexWrap: "nowrap" }}
            aspects={selectedAspects}
            iconSize={30}
          />
        </Box>
      </Tooltip>
    </Box>
  );
};
